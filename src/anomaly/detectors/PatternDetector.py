```python
import numpy as np
import cv2
from scipy import ndimage
from skimage.feature import greycomatrix, greycoprops
from sklearn.ensemble import IsolationForest


class PatternDetector:
    def __init__(self, sensitivity=0.5, texture_levels=8, glcm_distances=[1], glcm_angles=[0], outlier_contamination=0.01):
        self.sensitivity = sensitivity
        self.texture_levels = texture_levels
        self.glcm_distances = glcm_distances
        self.glcm_angles = glcm_angles
        self.outlier_contamination = outlier_contamination

        self.false_positive_filters = [
            self._filter_small_regions,
            self._filter_low_intensity_contrast
        ]

        # Isolation Forest for statistical outlier detection
        self.outlier_detector = IsolationForest(contamination=self.outlier_contamination, random_state=42)

    def detect(self, image):
        """
        Master function to detect anomaly patterns in a cardiac image.
        Input:
            image: 2D numpy array (grayscale cardiac image)
        Output:
            anomalies: list of dicts {
                'bbox': (x, y, w, h),
                'type': str,
                'confidence': float
            }
        """

        # Preprocessing (normalize and convert to 8-bit)
        img = self._preprocess(image)

        detected_patterns = []

        # Known anomaly pattern matching
        detected_patterns += self._match_known_patterns(img)

        # Morphological and spatial structural anomalies
        morph_anomalies = self._detect_morphological_anomalies(img)
        detected_patterns += morph_anomalies

        # Texture abnormalities detection
        texture_anomalies = self._detect_texture_anomalies(img)
        detected_patterns += texture_anomalies

        # Statistical outlier detection (on features)
        statistical_anomalies = self._detect_statistical_outliers(img)
        detected_patterns += statistical_anomalies

        # Filter false positives
        filtered = self._filter_false_positives(detected_patterns, img)

        # Clinical validation checks
        validated = [d for d in filtered if self._clinical_validation(d, img)]

        return validated

    def _preprocess(self, img):
        img = img.astype(np.float32)
        img = (img - img.min()) / (img.max() - img.min() + 1e-8)  # Normalize 0..1
        img = (img * 255).astype(np.uint8)
        return img

    def _match_known_patterns(self, img):
        # Placeholder for known anomaly templates (these would be pre-defined grayscale templates)
        known_patterns = {
            'ventricular_dilation': self._template_ventricular_dilation(),
            'septal_defect': self._template_septal_defect(),
        }
        detected = []
        for name, template in known_patterns.items():
            res = cv2.matchTemplate(img, template, cv2.TM_CCOEFF_NORMED)
            loc = np.where(res >= self.sensitivity)
            for pt in zip(*loc[::-1]):
                detected.append({
                    'bbox': (pt[0], pt[1], template.shape[1], template.shape[0]),
                    'type': name,
                    'confidence': float(res[pt[1], pt[0]])
                })
        return detected

    def _template_ventricular_dilation(self):
        # Simulated pattern for ventricular dilation (ellipse shape)
        tpl = np.zeros((40, 60), dtype=np.uint8)
        cv2.ellipse(tpl, (30, 20), (28, 18), 0, 0, 360, 255, -1)
        return tpl

    def _template_septal_defect(self):
        # Simulated pattern for septal wall defect (small round shape)
        tpl = np.zeros((20, 20), dtype=np.uint8)
        cv2.circle(tpl, (10, 10), 8, 255, -1)
        cv2.circle(tpl, (10, 10), 5, 0, -1)
        return tpl

    def _detect_morphological_anomalies(self, img):
        # Threshold image for bright structures
        _, binary = cv2.threshold(img, int(255 * self.sensitivity), 255, cv2.THRESH_BINARY)

        # Label connected components
        labeled, n = ndimage.label(binary)
        objects = ndimage.find_objects(labeled)

        results = []
        for i, sl in enumerate(objects, start=1):
            region = (labeled[sl] == i).astype(np.uint8)
            area = np.sum(region)
            if area < 50:
                continue  # too small - likely noise

            # Compute morphological features
            coords = np.column_stack(np.where(region))
            cov = np.cov(coords, rowvar=False)
            eigvals = np.linalg.eigvalsh(cov)
            eccentricity = np.sqrt(1 - min(eigvals) / (max(eigvals) + 1e-6))
            if eccentricity > 0.85 or area > 1000:
                x, y = sl[1].start, sl[0].start
                w, h = sl[1].stop - sl[1].start, sl[0].stop - sl[0].start
                results.append({
                    'bbox': (x, y, w, h),
                    'type': 'morphological_anomaly',
                    'confidence': float(min(1.0, eccentricity))
                })
        return results

    def _detect_texture_anomalies(self, img):
        # Compute grey level co-occurrence matrix (GLCM)
        image_quantized = np.floor_divide(img, 256 // self.texture_levels)
        glcm = greycomatrix(image_quantized, distances=self.glcm_distances, angles=self.glcm_angles,
                            levels=self.texture_levels, symmetric=True, normed=True)

        contrast = greycoprops(glcm, 'contrast').mean()
        dissimilarity = greycoprops(glcm, 'dissimilarity').mean()
        homogeneity = greycoprops(glcm, 'homogeneity').mean()
        energy = greycoprops(glcm, 'energy').mean()
        correlation = greycoprops(glcm, 'correlation').mean()

        texture_features = np.array([contrast, dissimilarity, homogeneity, energy, correlation]).reshape(1, -1)

        # Use IsolationForest on texture vector (fit only once in production - here, simulate)
        if not hasattr(self, '_texture_if_model'):
            self._texture_if_model = IsolationForest(contamination=self.outlier_contamination, random_state=42)
            self._texture_if_model.fit(np.array([[0, 0, 1, 1, 0]]))  # dummy fit to enable predict

        pred = self._texture_if_model.predict(texture_features)
        results = []
        if pred[0] == -1:  # anomaly
            results.append({
                'bbox': (0, 0, img.shape[1], img.shape[0]),
                'type': 'texture_anomaly',
                'confidence': float(min(1.0, contrast / 10))
            })
        return results

    def _detect_statistical_outliers(self, img):
        # Extract features per region for statistical outlier detection
        _, binary = cv2.threshold(img, int(255 * self.sensitivity), 255, cv2.THRESH_BINARY)

        labeled, n = ndimage.label(binary)
        objs = ndimage.find_objects(labeled)
        features = []
        regions = []

        for i, sl in enumerate(objs, start=1):
            region = (labeled[sl] == i).astype(np.uint8)
            area = np.sum(region)
            if area < 30:
                continue
            mean_intensity = np.mean(img[sl][region == 1])
            std_intensity = np.std(img[sl][region == 1])
            features.append([area, mean_intensity, std_intensity])
            regions.append(sl)

        if not features:
            return []

        features = np.array(features)
        self.outlier_detector.fit(features)
        preds = self.outlier_detector.predict(features)

        results = []
        for i, p in enumerate(preds):
            if p == -1:
                sl = regions[i]
                x, y = sl[1].start, sl[0].start
                w, h = sl[1].stop - sl[1].start, sl[0].stop - sl[0].start
                confidence = np.clip((features[i, 1] / 255) * self.sensitivity + 0.1, 0, 1)
                results.append({
                    'bbox': (x, y, w, h),
                    'type': 'statistical_outlier',
                    'confidence': float(confidence)
                })
        return results

    def _filter_false_positives(self, detections, img):
        filtered = []
        for d in detections:
            keep = True
            for f in self.false_positive_filters:
                if not f(d, img):
                    keep = False
                    break
            if keep:
                filtered.append(d)
        return filtered

    def _filter_small_regions(self, detection, img):
        _, _, w, h = detection['bbox']
        if w * h < 20:
            return False
        return True

    def _filter_low_intensity_contrast(self, detection, img):
        x, y, w, h = detection['bbox']
        crop = img[y:y + h, x:x + w]
        contrast = crop.max() - crop.min()
        if contrast < 15:
            return False
        return True

    def _clinical_validation(self, detection, img):
        # Clinical rules to reduce false alarms based on domain knowledge
        if detection['type'] == 'ventricular_dilation':
            # dilation regions should have approx elliptical shape and size constraints
            x, y, w, h = detection['bbox']
            aspect_ratio = w / (h + 1e-6)
            if not 0.8 <= aspect_ratio <= 1.5:
                return False

            region = img[y:y + h, x:x + w]
            mean_intensity = np.mean(region)
            if mean_intensity < 50:
                return False

        if detection['type'] == 'septal_defect':
            # typically small circular low intensity spots inside septal region
            if detection['confidence'] < 0.6:
                return False

        if detection['type'] == 'texture_anomaly':
            # texture anomalies require high confidence
            if detection['confidence'] < 0.7:
                return False

        if detection['type'] == 'statistical_outlier':
            # Outliers with very small area are unlikely clinically relevant
            x, y, w, h = detection['bbox']
            if w * h < 100:
                return False

        if detection['type'] == 'morphological_anomaly':
            # Morph anomalies very elongated or too large require confirmation
            if detection['confidence'] < 0.7:
                return False

        return True

    def set_sensitivity(self, value):
        self.sensitivity = max(0, min(1, value))

    def set_outlier_contamination(self, contamination):
        self.outlier_contamination = contamination
        self.outlier_detector.set_params(contamination=contamination)
```