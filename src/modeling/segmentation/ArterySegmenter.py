```python
import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from scipy.ndimage import label, generate_binary_structure, distance_transform_edt
from skimage.morphology import skeletonize
from skimage.segmentation import active_contour
from skimage.filters import gaussian
from scipy.spatial import cKDTree

class RegionGrowing:
    def __init__(self, threshold_lower, threshold_upper, connectivity=6, max_region_size=None):
        self.threshold_lower = threshold_lower
        self.threshold_upper = threshold_upper
        self.connectivity = connectivity
        self.max_region_size = max_region_size

    def grow(self, image, seed_points):
        """
        Perform multi-seed region growing on 3D CT volume.
        """
        assert image.ndim == 3
        segmentation = np.zeros_like(image, dtype=np.bool_)
        visited = np.zeros_like(image, dtype=np.bool_)

        neighbors = self._get_neighbors_3d(self.connectivity)

        queue = []
        for seed in seed_points:
            queue.append(tuple(seed))
            segmentation[tuple(seed)] = True
            visited[tuple(seed)] = True

        while queue:
            voxel = queue.pop(0)
            for delta in neighbors:
                n = tuple(np.array(voxel) + delta)
                if self._in_bounds(n, image.shape) and not visited[n]:
                    if self.threshold_lower <= image[n] <= self.threshold_upper:
                        segmentation[n] = True
                        queue.append(n)
                    visited[n] = True
            if self.max_region_size and segmentation.sum() >= self.max_region_size:
                break
        return segmentation

    def _in_bounds(self, idx, shape):
        return all(0 <= idx[d] < shape[d] for d in range(len(shape)))

    def _get_neighbors_3d(self, connectivity):
        if connectivity == 6:
            return [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
        elif connectivity == 18:
            neighbors = []
            for dx in [-1,0,1]:
                for dy in [-1,0,1]:
                    for dz in [-1,0,1]:
                        if (dx,dy,dz) != (0,0,0):
                            neighbors.append((dx,dy,dz))
            return neighbors
        elif connectivity == 26:
            neighbors = []
            for dx in [-1,0,1]:
                for dy in [-1,0,1]:
                    for dz in [-1,0,1]:
                        if (dx,dy,dz) != (0,0,0):
                            neighbors.append((dx,dy,dz))
            return neighbors
        else:
            raise ValueError("Unsupported connectivity")

class ActiveContour3D:
    def __init__(self, alpha=0.015, beta=10, gamma=0.001, max_iterations=250):
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma
        self.max_iterations = max_iterations

    def segment(self, volume, init_contour_points):
        """
        Apply active contour (snake) algorithm slice-wise along vessel centerlines.
        volume: 3D numpy array (CT volume)
        init_contour_points: list of 2D numpy arrays (x,y points) per slice as initial contour
        Returns: 3D segmentation mask
        """
        segmentation = np.zeros_like(volume, dtype=np.bool_)

        for i, snake in enumerate(init_contour_points):
            if snake.shape[0] < 3:
                continue
            slice_img = volume[i]
            snake_smoothed = active_contour(gaussian(slice_img, 1),
                                            snake,
                                            alpha=self.alpha,
                                            beta=self.beta,
                                            gamma=self.gamma,
                                            max_iterations=self.max_iterations,
                                            coordinates='rc')
            mask = self._contour_to_mask(slice_img.shape, snake_smoothed)
            segmentation[i] = mask
        return segmentation

    def _contour_to_mask(self, shape, contour):
        mask = np.zeros(shape, dtype=np.bool_)
        pts = np.array(contour, dtype=np.int32)
        if pts.shape[0] >= 3:
            mask = cv2.fillPoly(mask.astype(np.uint8), [pts[:,::-1]], 1).astype(np.bool_)
        return mask

class CalciumArtifactHandler:
    def __init__(self, intensity_threshold=1300, dilation_radius=2):
        self.intensity_threshold = intensity_threshold
        self.dilation_radius = dilation_radius

    def suppress(self, volume, vessel_mask):
        """
        Suppress calcium blooming artifacts by detecting high intensity clusters 
        and dilating vessel masks to compensate.
        """
        ca_mask = volume > self.intensity_threshold
        ca_mask = self._morphological_dilation(ca_mask, self.dilation_radius)
        suppressed_mask = vessel_mask & (~ca_mask)
        return suppressed_mask

    def _morphological_dilation(self, mask, radius):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*radius+1, 2*radius+1))
        output = np.zeros_like(mask, dtype=np.uint8)
        for i in range(mask.shape[0]):
            output[i] = cv2.dilate(mask[i].astype(np.uint8), kernel)
        return output.astype(bool)

class SeedPointDetector:
    def __init__(self, intensity_threshold=300, min_distance=5):
        self.intensity_threshold = intensity_threshold
        self.min_distance = min_distance

    def detect(self, volume):
        """
        Automatically detect seed points in coronary arteries based on intensity and local maxima.
        Returns list of seed points in (z,y,x) order.
        """
        candidates = np.where(volume > self.intensity_threshold)
        points = np.vstack(candidates).T

        # Filter seeds by minimum distance
        if points.shape[0] == 0:
            return []

        tree = cKDTree(points)
        keep = []
        taken = set()

        for i, pt in enumerate(points):
            if i in taken:
                continue
            neighbors = tree.query_ball_point(pt, self.min_distance)
            keep.append(pt)
            taken.update(neighbors)

        return keep

class DeepVesselNet(nn.Module):
    def __init__(self, in_channels=1, out_channels=1, base_filters=32):
        super().__init__()
        self.encoder1 = nn.Sequential(
            nn.Conv3d(in_channels, base_filters, 3, padding=1),
            nn.BatchNorm3d(base_filters),
            nn.ReLU(inplace=True),
            nn.Conv3d(base_filters, base_filters, 3, padding=1),
            nn.BatchNorm3d(base_filters),
            nn.ReLU(inplace=True)
        )
        self.pool1 = nn.MaxPool3d(2)
        self.encoder2 = nn.Sequential(
            nn.Conv3d(base_filters, base_filters*2, 3, padding=1),
            nn.BatchNorm3d(base_filters*2),
            nn.ReLU(inplace=True),
            nn.Conv3d(base_filters*2, base_filters*2, 3, padding=1),
            nn.BatchNorm3d(base_filters*2),
            nn.ReLU(inplace=True)
        )
        self.pool2 = nn.MaxPool3d(2)

        self.bottleneck = nn.Sequential(
            nn.Conv3d(base_filters*2, base_filters*4, 3, padding=1),
            nn.BatchNorm3d(base_filters*4),
            nn.ReLU(inplace=True),
            nn.Conv3d(base_filters*4, base_filters*4, 3, padding=1),
            nn.BatchNorm3d(base_filters*4),
            nn.ReLU(inplace=True)
        )

        self.up2 = nn.ConvTranspose3d(base_filters*4, base_filters*2, 2, stride=2)
        self.decoder2 = nn.Sequential(
            nn.Conv3d(base_filters*4, base_filters*2, 3, padding=1),
            nn.BatchNorm3d(base_filters*2),
            nn.ReLU(inplace=True),
            nn.Conv3d(base_filters*2, base_filters*2, 3, padding=1),
            nn.BatchNorm3d(base_filters*2),
            nn.ReLU(inplace=True)
        )

        self.up1 = nn.ConvTranspose3d(base_filters*2, base_filters, 2, stride=2)
        self.decoder1 = nn.Sequential(
            nn.Conv3d(base_filters*2, base_filters, 3, padding=1),
            nn.BatchNorm3d(base_filters),
            nn.ReLU(inplace=True),
            nn.Conv3d(base_filters, base_filters, 3, padding=1),
            nn.BatchNorm3d(base_filters),
            nn.ReLU(inplace=True)
        )

        self.out_conv = nn.Conv3d(base_filters, out_channels, 1)

    def forward(self, x):
        enc1 = self.encoder1(x)
        p1 = self.pool1(enc1)
        enc2 = self.encoder2(p1)
        p2 = self.pool2(enc2)

        bottleneck = self.bottleneck(p2)

        up2 = self.up2(bottleneck)
        cat2 = torch.cat([up2, enc2], dim=1)
        dec2 = self.decoder2(cat2)

        up1 = self.up1(dec2)
        cat1 = torch.cat([up1, enc1], dim=1)
        dec1 = self.decoder1(cat1)

        out = self.out_conv(dec1)
        return torch.sigmoid(out)

class VesselTreeReconstructor:
    def __init__(self):
        pass

    def reconstruct(self, vessel_mask):
        """
        Given a 3D vessel segmentation mask, reconstruct vessel tree skeleton.
        Returns skeleton and adjacency graph (as dict {node: [connected nodes]}).
        """
        skeleton = skeletonize(vessel_mask)
        coords = np.array(np.where(skeleton)).T

        tree = {}
        kd_tree = cKDTree(coords)

        for idx, pt in enumerate(coords):
            neighbors_idx = kd_tree.query_ball_point(pt, 1.5)
            neighbors_idx = [n for n in neighbors_idx if n != idx]
            tree[tuple(pt)] = [tuple(coords[n]) for n in neighbors_idx]

        return skeleton, tree

class QualityValidator:
    def __init__(self, min_volume=50, max_smoothness=1.5):
        self.min_volume = min_volume
        self.max_smoothness = max_smoothness

    def validate(self, segmentation, original_volume):
        """
        Validate segmentation quality based on volume, intensity consistency,
        and smoothness criteria.
        Returns True if passed, False otherwise.
        """
        volume_voxels = segmentation.sum()
        if volume_voxels < self.min_volume:
            return False

        vessel_intensity = original_volume[segmentation]

        mean_intensity = vessel_intensity.mean()
        std_intensity = vessel_intensity.std()
        if std_intensity / mean_intensity > 0.5:
            return False

        # Rough smoothness estimate by distance transform std in vessel
        dist = distance_transform_edt(segmentation)
        if dist.std() > self.max_smoothness:
            return False

        return True

class ArterySegmenter:
    def __init__(self,
                 volume,
                 intensity_range=(200, 600),
                 region_growing_connectivity=6,
                 seed_intensity_threshold=300,
                 calcium_intensity_threshold=1300,
                 device='cpu',
                 deepnet_checkpoint=None):
        self.volume = volume.astype(np.float32)
        self.threshold_lower = intensity_range[0]
        self.threshold_upper = intensity_range[1]
        self.connectivity = region_growing_connectivity

        self.seed_detector = SeedPointDetector(intensity_threshold=seed_intensity_threshold)
        self.region_growing = RegionGrowing(self.threshold_lower, self.threshold_upper, self.connectivity)
        self.active_contour = ActiveContour3D()
        self.calcium_handler = CalciumArtifactHandler(intensity_threshold=calcium_intensity_threshold)
        self.reconstructor = VesselTreeReconstructor()
        self.validator = QualityValidator()

        self.device = device
        self.deepnet = DeepVesselNet().to(device)
        if deepnet_checkpoint:
            self.deepnet.load_state_dict(torch.load(deepnet_checkpoint, map_location=device))
        self.deepnet.eval()

    def segment_multi_vessels(self):
        seed_points = self.seed_detector.detect(self.volume)
        if not seed_points:
            return np.zeros_like(self.volume, dtype=np.bool_)

        multi_vessel_mask = np.zeros_like(self.volume, dtype=np.bool_)
        for seed in seed_points:
            region_mask = self.region_growing.grow(self.volume, [seed])
            region_mask = self.calcium_handler.suppress(self.volume, region_mask)
            # Optional: refine per vessel with active contour slice-wise
            init_contour_points = self._generate_init_contours(region_mask)
            refined_mask = self.active_contour.segment(self.volume, init_contour_points)

            combined_mask = region_mask | refined_mask
            if self.validator.validate(combined_mask, self.volume):
                multi_vessel_mask = multi_vessel_mask | combined_mask

        vessel_tree = self.reconstructor.reconstruct(multi_vessel_mask)
        return multi_vessel_mask, vessel_tree

    def _generate_init_contours(self, vessel_mask):
        contours = []
        for i in range(vessel_mask.shape[0]):
            slice_mask = vessel_mask[i].astype(np.uint8)
            if slice_mask.sum() == 0:
                contours.append(np.empty((0, 2)))
                continue
            contours_in_slice, _ = cv2.findContours(slice_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours_in_slice:
                largest = max(contours_in_slice, key=cv2.contourArea).squeeze()
                if largest.ndim == 1:
                    largest = largest[np.newaxis, :]
                contours.append(largest)
            else:
                contours.append(np.empty((0, 2)))
        return contours

    def segment_deep_learning(self, patch_size=(64,64,64), batch_size=2):
        self.deepnet.eval()
        vol = self.volume[np.newaxis, np.newaxis, ...]  # 1,1,D,H,W
        vol_tensor = torch.from_numpy(vol).float().to(self.device)
        with torch.no_grad():
            pred = self.deepnet(vol_tensor)
        pred_mask = (pred.cpu().numpy()[0,0] > 0.5)
        masked = self.calcium_handler.suppress(self.volume, pred_mask)
        if self.validator.validate(masked, self.volume):
            vessel_tree = self.reconstructor.reconstruct(masked)
            return masked, vessel_tree
        return np.zeros_like(self.volume, dtype=np.bool_), {}

    def segment(self, method='multi'):
        if method == 'multi':
            return self.segment_multi_vessels()
        elif method == 'deep':
            return self.segment_deep_learning()
        else:
            raise ValueError(f'Unknown segmentation method {method}')
```