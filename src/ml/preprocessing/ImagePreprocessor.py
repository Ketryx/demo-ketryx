```python
import numpy as np
import pydicom
import SimpleITK as sitk
from scipy.ndimage import gaussian_filter
from skimage.transform import resize
import random


class ImagePreprocessor:
    def __init__(self,
                 target_shape=(256, 256),
                 padding_value=0,
                 noise_reduction_sigma=1.0,
                 roi_margin=10):
        self.target_shape = target_shape
        self.padding_value = padding_value
        self.noise_reduction_sigma = noise_reduction_sigma
        self.roi_margin = roi_margin

    def load_dicom(self, filepath):
        ds = pydicom.dcmread(filepath)
        if 'PixelData' not in ds:
            raise ValueError("DICOM file missing pixel data")

        image = ds.pixel_array.astype(np.float32)
        if hasattr(ds, 'RescaleSlope') and hasattr(ds, 'RescaleIntercept'):
            image = image * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
        return image, ds

    def normalize(self, image):
        min_val = np.min(image)
        max_val = np.max(image)
        if max_val - min_val == 0:
            return np.zeros_like(image)
        norm_img = (image - min_val) / (max_val - min_val)
        return norm_img

    def standardize(self, image):
        mean = np.mean(image)
        std = np.std(image)
        if std == 0:
            return np.zeros_like(image)
        std_img = (image - mean) / std
        return std_img

    def extract_coronary_roi(self, image, ds):
        # Extract coronary arteries region based on DICOM tags if available
        # Otherwise, fall back to central cropping considering roi_margin
        # This is a simplified heuristic approach
        shape = image.shape

        # Attempt to use Image Position / Orientation or tags for ROI location (if present)
        # Here, as placeholder, crop central region with margin
        center_x, center_y = shape[1] // 2, shape[0] // 2
        left = max(center_x - self.roi_margin, 0)
        right = min(center_x + self.roi_margin, shape[1])
        top = max(center_y - self.roi_margin, 0)
        bottom = min(center_y + self.roi_margin, shape[0])

        roi = image[top:bottom, left:right]
        return roi

    def augment(self, image):
        # Random flips
        if random.random() > 0.5:
            image = np.fliplr(image)
        if random.random() > 0.5:
            image = np.flipud(image)

        # Random rotation by 90 degree increments
        k = random.choice([0, 1, 2, 3])
        image = np.rot90(image, k)

        # Random intensity scaling
        scale = random.uniform(0.9, 1.1)
        image = np.clip(image * scale, 0, 1)

        # Add slight Gaussian noise
        noise = np.random.normal(0, 0.01, image.shape)
        image = np.clip(image + noise, 0, 1)

        return image

    def resize_and_pad(self, image):
        # Resize while keeping aspect ratio and pad to target_shape
        img_h, img_w = image.shape
        target_h, target_w = self.target_shape

        scale = min(target_h / img_h, target_w / img_w)
        new_h = int(img_h * scale)
        new_w = int(img_w * scale)
        resized_img = resize(image, (new_h, new_w), anti_aliasing=True)

        padded_img = np.full(self.target_shape, self.padding_value, dtype=resized_img.dtype)
        top = (target_h - new_h) // 2
        left = (target_w - new_w) // 2
        padded_img[top:top + new_h, left:left + new_w] = resized_img
        return padded_img

    def reduce_noise(self, image):
        filtered = gaussian_filter(image, sigma=self.noise_reduction_sigma)
        return filtered

    def validate_quality(self, image):
        # Reject image if mean intensity is too low or too high
        mean_intensity = np.mean(image)
        if mean_intensity < 0.05 or mean_intensity > 0.95:
            return False

        # Reject image if too noisy by checking std dev
        std_intensity = np.std(image)
        if std_intensity < 0.01:
            return False

        return True

    def preprocess(self, filepath, augment=False):
        image, ds = self.load_dicom(filepath)
        normalized = self.normalize(image)
        filtered = self.reduce_noise(normalized)
        roi = self.extract_coronary_roi(filtered, ds)

        if augment:
            roi = self.augment(roi)

        resized = self.resize_and_pad(roi)
        standardized = self.standardize(resized)

        if not self.validate_quality(standardized):
            raise ValueError("Image quality validation failed")

        return standardized
```