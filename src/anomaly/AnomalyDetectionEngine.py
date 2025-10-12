```python
import logging
from typing import List, Dict, Any, Tuple
import numpy as np
import tensorflow as tf

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
ch = logging.StreamHandler()
ch.setLevel(logging.DEBUG)
formatter = logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s')
ch.setFormatter(formatter)
logger.addHandler(ch)


class AnomalyDetector:
    ANOMALY_CLASSES = ['calcification', 'plaque', 'stenosis', 'other']

    def __init__(self, model_path: str):
        logger.info("Initializing AnomalyDetector")
        try:
            self.model = tf.keras.models.load_model(model_path)
            logger.info(f"Model loaded from {model_path}")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise RuntimeError(f"Failed to load model from {model_path}") from e

    def detect_anomalies(self, ct_images: List[np.ndarray]) -> List[List[Dict[str, Any]]]:
        """
        Processes a batch of cardiac CT images and returns flagged anomaly regions.

        Args:
            ct_images: List of 3D numpy arrays representing cardiac CT scans.

        Returns:
            List of lists of dict where each dict contains:
                - region: tuple of slices defining flagged region
                - pattern: anomaly class label
                - confidence: float confidence score [0,1]
        """
        logger.debug(f"Processing batch of {len(ct_images)} images")
        results = []
        for idx, img in enumerate(ct_images):
            logger.debug(f"Processing image {idx + 1}/{len(ct_images)}")
            flagged_regions = self._process_single_image(img)
            results.append(flagged_regions)
            logger.debug(f"Image {idx + 1} produced {len(flagged_regions)} flagged regions")
        return results

    def _process_single_image(self, ct_image: np.ndarray) -> List[Dict[str, Any]]:
        """
        Internal method to process a single cardiac CT image.

        Args:
            ct_image: 3D numpy array of the cardiac CT scan.

        Returns:
            List of flagged anomaly dictionaries.
        """
        regions = self._segment_regions(ct_image)
        flagged = []

        for region_idx, region_data in enumerate(regions):
            features = self._extract_features(region_data)
            prediction, confidence = self._classify(features)
            if confidence >= 0.5:  # Threshold to flag anomaly
                anomaly = {
                    'region': region_data['bbox'],
                    'pattern': prediction,
                    'confidence': float(confidence)
                }
                flagged.append(anomaly)
                logger.debug(f"Flagged region {region_idx} with pattern {prediction} (conf: {confidence:.3f})")
        return flagged

    def _segment_regions(self, ct_image: np.ndarray) -> List[Dict[str, Any]]:
        """
        Segments the CT image into candidate regions for anomaly detection.

        Args:
            ct_image: 3D array of cardiac CT.

        Returns:
            List of dicts with 'image' slice and 'bbox' tuple(region coordinates).
        """
        # Placeholder simple segmentation by thresholding + connected component labeling
        threshold = 150  # HU threshold example for calcified plaque
        bin_img = ct_image > threshold

        # Connected components (using TensorFlow or scipy)
        import scipy.ndimage
        labeled, num_features = scipy.ndimage.label(bin_img)
        regions = []

        for i in range(1, num_features + 1):
            region_mask = (labeled == i)
            coords = np.where(region_mask)
            z_min, z_max = coords[0].min(), coords[0].max() + 1
            y_min, y_max = coords[1].min(), coords[1].max() + 1
            x_min, x_max = coords[2].min(), coords[2].max() + 1
            bbox = (slice(z_min, z_max), slice(y_min, y_max), slice(x_min, x_max))
            region_img = ct_image[bbox]
            regions.append({'image': region_img, 'bbox': bbox})
        logger.debug(f"Segmented {num_features} candidate regions")
        return regions

    def _extract_features(self, region: Dict[str, Any]) -> np.ndarray:
        """
        Extract numerical features from the region for classification.

        Args:
            region: Dict with 'image' 3D array slice.

        Returns:
            1D numpy array of features.
        """
        region_img = region['image']
        features = [
            np.mean(region_img),                  # mean intensity
            np.std(region_img),                   # intensity variance
            np.percentile(region_img, 90),       # 90th percentile intensity
            region_img.size,                      # volume
        ]
        return np.array(features).reshape(1, -1).astype(np.float32)

    def _classify(self, features: np.ndarray) -> Tuple[str, float]:
        """
        Predict the anomaly type and confidence score.

        Args:
            features: Feature vector np.ndarray.

        Returns:
            Tuple of (pattern label, confidence score)
        """
        preds = self.model.predict(features)
        idx = np.argmax(preds)
        confidence = preds[0, idx]
        label = self.ANOMALY_CLASSES[idx] if idx < len(self.ANOMALY_CLASSES) else 'other'
        return label, confidence

    def integrate_with_clinical_workflow(self, flagged_regions: List[List[Dict[str, Any]]], patient_metadata: List[Dict[str, Any]]) -> None:
        """
        Integration point placeholder for exporting flagged anomalies in clinical workflow.

        Args:
            flagged_regions: output from detect_anomalies.
            patient_metadata: list of metadata dicts matching the images processed.

        This could be extended to interface with PACS, EHR, or notify clinicians.
        """
        logger.info("Integrating results with clinical workflow")
        for i, (regions, meta) in enumerate(zip(flagged_regions, patient_metadata)):
            patient_id = meta.get('patient_id', 'unknown')
            study_id = meta.get('study_id', 'unknown')
            logger.info(f"Patient {patient_id} Study {study_id} - {len(regions)} anomalies detected")
            for anomaly in regions:
                r = anomaly['region']
                logger.info(f" - Region {r} Pattern: {anomaly['pattern']} Confidence: {anomaly['confidence']:.2f}")
```