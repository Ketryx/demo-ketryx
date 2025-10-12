```python
import os
import numpy as np
import pydicom
import cv2
from scipy.ndimage import gaussian_filter
from skimage import exposure
from skimage.util import random_noise
from typing import List, Tuple, Optional, Union, Generator
import logging
import threading

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ImagePreprocessor:
    def __init__(
        self,
        normalize_method: str = "minmax",  # options: 'minmax', 'zscore'
        noise_reduction_method: Optional[str] = "gaussian",  # None or 'gaussian', 'median'
        noise_reduction_params: Optional[dict] = None,
        augmentation_params: Optional[dict] = None,
        roi_size: Optional[Tuple[int, int]] = None,
        seed: Optional[int] = None,
    ):
        """
        Initializes the ImagePreprocessor.
        
        Args:
            normalize_method: Method to normalize/standardize images.
            noise_reduction_method: Noise reduction filter to apply.
            noise_reduction_params: Parameters for noise filters.
            augmentation_params: Data augmentation settings, e.g. {'flip': True, 'rotation': 15}.
            roi_size: (height, width) of the region of interest to crop around the image center.
            seed: Random seed for reproducibility of augmentations.
        """
        self.normalize_method = normalize_method.lower()
        if self.normalize_method not in ("minmax", "zscore"):
            raise ValueError("normalize_method must be 'minmax' or 'zscore'")
        
        self.noise_reduction_method = noise_reduction_method
        self.noise_reduction_params = noise_reduction_params or {}

        self.augmentation_params = augmentation_params or {}
        self.roi_size = roi_size
        if seed is not None:
            np.random.seed(seed)
            self.seed = seed
        else:
            self.seed = None

        self.lock = threading.Lock()

    @staticmethod
    def _extract_pixel_array(ds: pydicom.FileDataset) -> np.ndarray:
        """
        Extract the pixel array from DICOM dataset with CT specific windowing applied if present.
        """
        img = ds.pixel_array.astype(np.float32)

        intercept = getattr(ds, "RescaleIntercept", 0.0)
        slope = getattr(ds, "RescaleSlope", 1.0)
        img = img * slope + intercept
        return img

    def read_dicom(self, filepath: str) -> Tuple[np.ndarray, dict]:
        """
        Reads DICOM file and returns image array and metadata.

        Args:
            filepath: Path to DICOM file.

        Returns:
            Tuple of (image ndarray, metadata dictionary)
        """
        if not os.path.isfile(filepath):
            raise FileNotFoundError(f"DICOM file not found: {filepath}")

        # Read DICOM
        ds = pydicom.dcmread(filepath, force=True)

        # HIPAA compliance note: No patient metadata is returned.
        img = self._extract_pixel_array(ds)
        metadata = {
            "Modality": getattr(ds, "Modality", None),
            "StudyDate": getattr(ds, "StudyDate", None),
            "Manufacturer": getattr(ds, "Manufacturer", None),
            "PixelSpacing": getattr(ds, "PixelSpacing", None),
            "SliceThickness": getattr(ds, "SliceThickness", None),
            "ImagePositionPatient": getattr(ds, "ImagePositionPatient", None),
            "ImageOrientationPatient": getattr(ds, "ImageOrientationPatient", None),
            "PhotometricInterpretation": getattr(ds, "PhotometricInterpretation", None),
            "Rows": getattr(ds, "Rows", None),
            "Columns": getattr(ds, "Columns", None),
        }
        return img, metadata

    def normalize(self, image: np.ndarray) -> np.ndarray:
        """
        Normalizes or standardizes the image.

        Args:
            image: CT image array.

        Returns:
            Normalized/standardized image.
        """
        if self.normalize_method == "minmax":
            img_min = np.min(image)
            img_max = np.max(image)
            if img_max - img_min == 0:
                logger.warning("Image max equals min, returning zeros.")
                return np.zeros_like(image)
            normalized = (image - img_min) / (img_max - img_min)
            return normalized.astype(np.float32)
        else:  # zscore
            mean = np.mean(image)
            std = np.std(image)
            if std == 0:
                logger.warning("Image std is zero, returning zeros.")
                return np.zeros_like(image)
            standardized = (image - mean) / std
            return standardized.astype(np.float32)

    def apply_noise_reduction(self, image: np.ndarray) -> np.ndarray:
        """
        Applies noise reduction filters based on configuration.

        Args:
            image: Image array.

        Returns:
            Noise reduced image.
        """
        if not self.noise_reduction_method:
            return image

        if self.noise_reduction_method == "gaussian":
            sigma = self.noise_reduction_params.get("sigma", 1)
            filtered = gaussian_filter(image, sigma=sigma)
            return filtered.astype(np.float32)

        if self.noise_reduction_method == "median":
            ksize = self.noise_reduction_params.get("ksize", 3)
            ksize = max(3, ksize if ksize % 2 == 1 else ksize + 1)  # must be odd and >=3
            filtered = cv2.medianBlur(image.astype(np.float32), ksize)
            return filtered

        logger.warning(f"Unknown noise reduction method: {self.noise_reduction_method}. No filtering applied.")
        return image

    def extract_roi(self, image: np.ndarray) -> np.ndarray:
        """
        Extracts region of interest from image centered around the image center.

        Args:
            image: Image array.

        Returns:
            Cropped ROI image.
        """
        if self.roi_size is None:
            return image

        h, w = image.shape[:2]
        roi_h, roi_w = self.roi_size

        if roi_h > h or roi_w > w:
            logger.warning("ROI size larger than image size. Returning original image.")
            return image

        center_y, center_x = h // 2, w // 2
        y1 = max(center_y - roi_h // 2, 0)
        y2 = y1 + roi_h
        x1 = max(center_x - roi_w // 2, 0)
        x2 = x1 + roi_w

        roi = image[y1:y2, x1:x2]
        return roi

    def augment(
        self,
        image: np.ndarray,
    ) -> np.ndarray:
        """
        Applies data augmentation techniques.

        Supported augmentations:
            - horizontal flip (flip_h)
            - vertical flip (flip_v)
            - rotation (degrees)
            - add random Gaussian noise (gaussian_noise_std)

        Args:
            image: Image array.

        Returns:
            Augmented image.
        """
        aug_img = image.copy()

        if self.augmentation_params.get("flip_h", False):
            aug_img = np.fliplr(aug_img)

        if self.augmentation_params.get("flip_v", False):
            aug_img = np.flipud(aug_img)

        rotation = self.augmentation_params.get("rotation", 0)
        if rotation != 0:
            # Rotate around center without cropping
            h, w = aug_img.shape[:2]
            M = cv2.getRotationMatrix2D((w // 2, h // 2), rotation, 1.0)
            aug_img = cv2.warpAffine(
                aug_img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
            )

        gauss_noise_std = self.augmentation_params.get("gaussian_noise_std", 0)
        if gauss_noise_std > 0:
            noise = np.random.normal(0, gauss_noise_std, aug_img.shape)
            aug_img = aug_img + noise
            aug_img = np.clip(aug_img, aug_img.min(), aug_img.max())

        return aug_img.astype(np.float32)

    def validate_quality(self, image: np.ndarray) -> bool:
        """
        Basic quality validation.

        Checks:
            - Image not empty or all zeros
            - Sufficient contrast (based on intensity percentile range)
            - No extreme intensity saturation

        Args:
            image: Image array.

        Returns:
            True if quality checks pass; False otherwise.
        """
        if image is None or image.size == 0:
            logger.warning("Empty image detected during validation.")
            return False
        if np.all(image == image.flat[0]):
            logger.warning("Image has constant intensity.")
            return False

        p1, p99 = np.percentile(image, (1, 99))
        if (p99 - p1) < 10e-3:
            logger.warning("Image contrast too low.")
            return False

        satur_threshold = 0.99
        satur_ratio = np.sum(image >= satur_threshold * image.max()) / image.size
        if satur_ratio > 0.05:  # >5% pixels saturated
            logger.warning("Image saturation too high.")
            return False

        return True

    def process_single(self, filepath: str, augment: bool = True) -> Optional[np.ndarray]:
        """
        End-to-end preprocessing for a single DICOM file.

        Args:
            filepath: Path to DICOM file.
            augment: Whether to apply augmentation.

        Returns:
            Preprocessed image or None if validation fails.
        """
        try:
            img, _ = self.read_dicom(filepath)
        except Exception as e:
            logger.error(f"Failed to read DICOM {filepath}: {e}")
            return None

        img = self.normalize(img)
        img = self.apply_noise_reduction(img)
        img = self.extract_roi(img)
        if augment:
            img = self.augment(img)

        if not self.validate_quality(img):
            logger.info(f"Image quality validation failed for {filepath}")
            return None

        return img

    def process_batch(
        self, filepaths: List[str], batch_size: int = 8, augment: bool = True
    ) -> Generator[np.ndarray, None, None]:
        """
        Processes a batch of DICOM files yielding processed images.

        Args:
            filepaths: List of DICOM file paths.
            batch_size: Number of images to process per batch.
            augment: Whether to apply augmentation.

        Yields:
            Processed images batch by batch as numpy arrays of shape (batch_size, H, W).
            The last batch may have fewer than batch_size images.
        """
        batch_images = []
        for idx, path in enumerate(filepaths):
            img = self.process_single(path, augment=augment)
            if img is None:
                continue
            batch_images.append(img)
            if len(batch_images) == batch_size:
                yield np.stack(batch_images)
                batch_images.clear()

        if batch_images:
            yield np.stack(batch_images)

```