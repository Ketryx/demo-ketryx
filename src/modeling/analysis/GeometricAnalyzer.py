```python
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree
from sklearn.decomposition import PCA


class GeometricAnalyzer:
    def __init__(self, vessel_points, branches=None, reference_points=None):
        """
        Initialize with vessel surface points and optional branches and reference anatomy points.

        Parameters
        ----------
        vessel_points : (N, 3) np.ndarray
            3D points representing the coronary artery surface.
        branches : list of (M_i, 3) np.ndarray or None
            List of arrays for individual vessel branches (optional).
        reference_points : (K, 3) np.ndarray or None
            3D points representing reference (healthy) artery centerline for comparison.
        """
        self.vessel_points = vessel_points
        self.branches = branches
        self.reference_points = reference_points
        self.centerline = None
        self.branch_points = None
        self.diameters = None
        self.curvature = None
        self.tortuosity = None
        self.stenosis = None
        self.metrics = {}

    def extract_centerline(self, num_points=200, smooth_sigma=3):
        """
        Extract centerline using PCA-based skeletonization and resampling.

        Returns
        -------
        centerline : (num_points, 3) np.ndarray
            Resampled and smoothed centerline points.
        """
        # Approximate centerline via PCA line + iterative refinement
        points = self.vessel_points
        pca = PCA(n_components=1)
        pca.fit(points)
        axis = pca.components_[0]
        origin = pca.mean_

        # Project points onto PCA axis
        proj_lengths = np.dot(points - origin, axis)
        sorted_idx = np.argsort(proj_lengths)
        ordered_points = points[sorted_idx]

        # Create initial centerline by binning projected points and averaging within bins
        bins = np.linspace(proj_lengths.min(), proj_lengths.max(), num_points + 1)
        centerline = np.zeros((num_points, 3))
        for i in range(num_points):
            mask = (proj_lengths >= bins[i]) & (proj_lengths < bins[i + 1])
            if np.any(mask):
                centerline[i] = points[mask].mean(axis=0)
            else:
                # fallback to interpolation along PCA axis
                centerline[i] = origin + axis * (bins[i] + bins[i + 1]) / 2

        # Smooth centerline spatially
        centerline = gaussian_filter1d(centerline, sigma=smooth_sigma, axis=0, mode='nearest')

        self.centerline = centerline
        return centerline

    def measure_diameter(self, radius_samples=16):
        """
        Measure vessel diameter along the extracted centerline by estimating radial distances.

        Parameters
        ----------
        radius_samples : int
            Number of sample directions around each centerline point for diameter estimation.

        Returns
        -------
        diameters : (N,) np.ndarray
            Diameter at each centerline point.
        """
        if self.centerline is None:
            raise RuntimeError("Centerline must be extracted first")

        points = self.vessel_points
        centerline = self.centerline
        N = centerline.shape[0]
        diameters = np.zeros(N)

        kdtree = cKDTree(points)

        # Compute local tangent vectors
        tangents = np.gradient(centerline, axis=0)
        tangents /= np.linalg.norm(tangents, axis=1, keepdims=True)

        for i in range(N):
            p = centerline[i]
            t = tangents[i]
            # Create an orthonormal basis: t, u, v
            # u,v span the plane orthogonal to t
            # To find u:
            arbitrary = np.array([1, 0, 0]) if abs(t[0]) < 0.9 else np.array([0, 1, 0])
            u = np.cross(t, arbitrary)
            u /= np.linalg.norm(u)
            v = np.cross(t, u)

            max_radial_dist = 0
            angles = np.linspace(0, 2 * np.pi, radius_samples, endpoint=False)
            radial_distances = []
            for angle in angles:
                direction = np.cos(angle) * u + np.sin(angle) * v

                # Sample along the direction from centerline point outward
                length_search = 5.0  # max search radius in mm
                samples = np.linspace(0, length_search, 50)
                line_points = p[None, :] + samples[:, None] * direction[None, :]

                # Query distance from vessel surface points
                dist, idx = kdtree.query(line_points)
                # Find boundary point approx when distance exceeds a threshold (half voxel size ~ baseline)
                threshold = 0.1
                boundary_mask = dist > threshold
                if np.any(boundary_mask):
                    first_idx = np.argmax(boundary_mask)
                    radial_distances.append(samples[first_idx])
                else:
                    # No clear boundary - take max search radius as radius
                    radial_distances.append(length_search)

            diameter = 2 * np.mean(radial_distances)
            diameters[i] = diameter

        self.diameters = diameters
        return diameters

    def compute_curvature(self, smoothing=5):
        """
        Compute curvature of the centerline.

        Parameters
        ----------
        smoothing : int
            Window size for gaussian smoothing of centerline derivatives.

        Returns
        -------
        curvature : (N,) np.ndarray
            Curvature values along centerline.
        """
        if self.centerline is None:
            raise RuntimeError("Centerline must be extracted first")

        c = self.centerline
        c_smooth = gaussian_filter1d(c, sigma=smoothing, axis=0, mode='nearest')

        dp = np.gradient(c_smooth, axis=0)
        ddp = np.gradient(dp, axis=0)

        numerator = np.linalg.norm(np.cross(dp, ddp), axis=1)
        denominator = (np.linalg.norm(dp, axis=1) ** 3) + 1e-12

        curvature = numerator / denominator

        self.curvature = curvature
        return curvature

    def detect_branch_points(self, search_radius=3.0, angle_threshold_deg=30):
        """
        Detect branch points by analyzing changes in local vessel orientation and nearby centerline points.

        Parameters
        ----------
        search_radius : float
            Radius in mm to consider neighbors for branch detection.
        angle_threshold_deg : float
            Minimum angle difference (degrees) between centerline segments to consider a branch.

        Returns
        -------
        branch_points : (M, 3) np.ndarray
            Coordinates of detected branch points.
        """

        if self.centerline is None:
            raise RuntimeError("Centerline must be extracted first")

        centerline = self.centerline
        kdtree = cKDTree(centerline)
        tangents = np.gradient(centerline, axis=0)
        tangents /= np.linalg.norm(tangents, axis=1, keepdims=True)

        branch_indices = []
        angle_threshold = np.deg2rad(angle_threshold_deg)

        for i, (p, t) in enumerate(zip(centerline, tangents)):
            # Find neighbors within radius excluding self
            neighbors_idx = kdtree.query_ball_point(p, search_radius)
            neighbors_idx = [n for n in neighbors_idx if n != i]
            if not neighbors_idx:
                continue

            # Compute angles between tangents
            angles = []
            for n_idx in neighbors_idx:
                tn = tangents[n_idx]
                a = np.arccos(np.clip(np.dot(t, tn), -1, 1))
                angles.append(a)

            distinct_angles = [a for a in angles if a > angle_threshold]

            if len(distinct_angles) >= 2:
                branch_indices.append(i)

        # Merge close branch detections
        if not branch_indices:
            self.branch_points = np.empty((0, 3))
            return self.branch_points

        branch_coords = centerline[branch_indices]
        merged = []
        visited = set()

        for i, b in enumerate(branch_coords):
            if i in visited:
                continue
            close = np.linalg.norm(branch_coords - b, axis=1) < (search_radius / 2)
            group = branch_coords[close]
            merged.append(group.mean(axis=0))
            visited.update(np.where(close)[0])

        self.branch_points = np.array(merged)
        return self.branch_points

    def calculate_tortuosity(self):
        """
        Calculate vessel tortuosity as ratio of actual centerline length over chord length.

        Returns
        -------
        tortuosity : float
            Tortuosity measure (>=1).
        """
        if self.centerline is None:
            raise RuntimeError("Centerline must be extracted first")

        c = self.centerline
        length = np.sum(np.linalg.norm(np.diff(c, axis=0), axis=1))
        chord = np.linalg.norm(c[-1] - c[0])

        tortuosity = length / (chord + 1e-12)
        self.tortuosity = tortuosity
        return tortuosity

    def quantify_stenosis(self, window_size=5):
        """
        Quantify stenosis as reduction in vessel diameter compared to maximum diameter segment.

        Parameters
        ----------
        window_size : int
            Number of centerline points to consider on each side when searching for max diameter.

        Returns
        -------
        stenosis_percent : float
            Percentage reduction in diameter at narrowest segment relative to max diameter.
        min_diameter_idx : int
            Index of the narrowest position.
        """
        if self.diameters is None:
            raise RuntimeError("Diameters must be measured first")

        d = self.diameters
        N = len(d)
        max_diameters = np.zeros(N)

        # Local max diameter in neighborhood window
        for i in range(N):
            start = max(i - window_size, 0)
            end = min(i + window_size + 1, N)
            max_diameters[i] = d[start:end].max()

        # Stenosis percentage at each point
        with np.errstate(divide='ignore', invalid='ignore'):
            stenosis = 100.0 * (1 - d / max_diameters)
            stenosis = np.clip(stenosis, 0, 100)

        # Find max stenosis area
        min_idx = np.argmax(stenosis)
        max_stenosis = stenosis[min_idx]

        self.stenosis = {
            'max_percent': max_stenosis,
            'location_idx': min_idx,
            'diameter_at_stenosis': d[min_idx],
            'max_local_diameter': max_diameters[min_idx],
        }
        return max_stenosis, min_idx

    def compare_with_reference(self, tolerance=2.0):
        """
        Compare extracted centerline and diameters with reference anatomy and produce deviation metrics.

        Parameters
        ----------
        tolerance : float
            Maximum distance in mm to consider matches between centerline points.

        Returns
        -------
        comparison_metrics : dict
            Quantitative metrics including average centerline deviation and diameter differences.
        """
        if self.centerline is None or self.diameters is None or self.reference_points is None:
            raise RuntimeError("Centerline, diameters, and reference points must be available")

        c = self.centerline
        ref = self.reference_points
        diameters = self.diameters

        ref_kdtree = cKDTree(ref)
        distances, idx = ref_kdtree.query(c, distance_upper_bound=tolerance)

        valid_mask = distances < tolerance
        if not np.any(valid_mask):
            raise RuntimeError("No centerline points matched to reference within tolerance")

        matched_ref_points = ref[idx[valid_mask]]
        matched_centerline_points = c[valid_mask]
        centerline_deviation = np.linalg.norm(matched_centerline_points - matched_ref_points, axis=1)

        # Here diameter comparison assumes similar sampling, use nearest ref indices matched to centerline
        ref_diameters = np.interp(
            np.linspace(0, len(ref) - 1, len(ref)),
            np.linspace(0, len(ref) - 1, len(ref)),
            np.full(len(ref), np.nan))  # Placeholder if ref diameters unknown

        # Since we lack ref diameters, just use deviation in centerline geometry
        avg_deviation = np.mean(centerline_deviation)
        max_deviation = np.max(centerline_deviation)

        comparison_metrics = {
            'avg_centerline_deviation_mm': avg_deviation,
            'max_centerline_deviation_mm': max_deviation,
            'matched_points': np.sum(valid_mask),
            'total_points': len(c),
        }
        self.metrics['comparison'] = comparison_metrics
        return comparison_metrics

    def compute_all_metrics(self):
        """
        Convenience method to compute all metrics and store in self.metrics dict.

        Returns
        -------
        metrics : dict
            Dictionary with all quantitative metric results.
        """
        self.extract_centerline()
        self.measure_diameter()
        self.compute_curvature()
        self.calculate_tortuosity()
        self.quantify_stenosis()

        self.metrics.update({
            'diameters': self.diameters,
            'curvature': self.curvature,
            'tortuosity': self.tortuosity,
            'stenosis': self.stenosis
        })

        if self.reference_points is not None:
            comp = self.compare_with_reference()
            self.metrics['comparison'] = comp

        if self.branch_points is None:
            self.detect_branch_points()
        self.metrics['branch_points'] = self.branch_points

        return self.metrics
```