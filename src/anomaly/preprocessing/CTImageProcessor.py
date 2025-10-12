```python
import os
import numpy as np
import pydicom
import SimpleITK as sitk
import cv2


class CTImageProcessor:
    def __init__(self, window_center=40, window_width=400, roi_size=(128, 128)):
        self.window_center = window_center
        self.window_width = window_width
        self.roi_size = roi_size

    def load_dicom(self, filepath):
        ds = pydicom.dcmread(filepath)
        pixel_array = ds.pixel_array.astype(np.int16)

        intercept = ds.get("RescaleIntercept", 0.0)
        slope = ds.get("RescaleSlope", 1.0)
        pixel_array = pixel_array * slope + intercept

        return pixel_array, ds

    def normalize_window(self, image):
        lower = self.window_center - self.window_width // 2
        upper = self.window_center + self.window_width // 2
        windowed = np.clip(image, lower, upper)
        windowed = (windowed - lower) / (upper - lower)
        windowed = (windowed * 255).astype(np.uint8)
        return windowed

    def enhance_contrast(self, image):
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(image)
        return enhanced

    def extract_roi(self, image, center=None):
        h, w = image.shape
        rh, rw = self.roi_size
        if center is None:
            center = (w // 2, h // 2)

        x1 = max(center[0] - rw // 2, 0)
        y1 = max(center[1] - rh // 2, 0)
        x2 = min(x1 + rw, w)
        y2 = min(y1 + rh, h)
        roi = image[y1:y2, x1:x2]

        # Padding if ROI is smaller than target
        if roi.shape[0] < rh or roi.shape[1] < rw:
            roi = cv2.copyMakeBorder(
                roi,
                0,
                rh - roi.shape[0],
                0,
                rw - roi.shape[1],
                cv2.BORDER_CONSTANT,
                value=0,
            )
        return roi

    def remove_artifacts(self, image):
        blurred = cv2.medianBlur(image, 5)
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        mask = np.zeros_like(image)

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if 500 < area < 50000:
                cv2.drawContours(mask, [cnt], -1, 255, cv2.FILLED)
        cleared = cv2.bitwise_and(image, mask)
        return cleared

    def reduce_noise(self, image):
        denoised = cv2.fastNlMeansDenoising(image, None, h=10, templateWindowSize=7, searchWindowSize=21)
        return denoised

    def segment_heart(self, image):
        sitk_img = sitk.GetImageFromArray(image)
        otsu_filter = sitk.OtsuThresholdImageFilter()
        otsu_filter.SetInsideValue(0)
        otsu_filter.SetOutsideValue(1)

        segment = otsu_filter.Execute(sitk_img)
        segment_array = sitk.GetArrayFromImage(segment).astype(np.uint8)

        # Morphological operations to clean up segmentation
        kernel = np.ones((5, 5), np.uint8)
        segment_array = cv2.morphologyEx(segment_array, cv2.MORPH_CLOSE, kernel)
        segment_array = cv2.morphologyEx(segment_array, cv2.MORPH_OPEN, kernel)

        return segment_array

    def quality_assessment(self, image):
        if image is None or image.size == 0:
            return False

        if np.std(image) < 10:
            return False

        blur_metric = cv2.Laplacian(image, cv2.CV_64F).var()
        if blur_metric < 50:
            return False

        return True

    def convert_for_model(self, image, target_shape=(1, 128, 128)):
        image = cv2.resize(image, (target_shape[2], target_shape[1]))
        image = image.astype(np.float32) / 255.0
        image = np.expand_dims(image, axis=0)
        return image

    def preprocess(self, dicom_path, roi_center=None):
        raw_img, ds = self.load_dicom(dicom_path)

        if not self.quality_assessment(raw_img):
            raise ValueError("Input image failed quality assessment.")

        windowed = self.normalize_window(raw_img)
        enhanced = self.enhance_contrast(windowed)
        artifact_free = self.remove_artifacts(enhanced)
        noise_reduced = self.reduce_noise(artifact_free)
        roi = self.extract_roi(noise_reduced, center=roi_center)

        segmented = self.segment_heart(roi)
        model_input = self.convert_for_model(segmented)

        return model_input, ds
```