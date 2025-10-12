```python
import os
import logging
from typing import Tuple, Optional

import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, optimizers
from tensorflow.keras.preprocessing.image import img_to_array
from tensorflow.keras.utils import to_categorical
import cv2


logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)

# Constants
IMG_SIZE = (128, 128)
NUM_CLASSES = 4  # e.g., 0: no blockage, 1: mild, 2: moderate, 3: severe


class BlockageDetectionModel:
    def __init__(self, model_path: Optional[str] = None):
        self.device = '/GPU:0' if tf.config.list_physical_devices('GPU') else '/CPU:0'
        logger.info(f"Using device: {self.device}")

        with tf.device(self.device):
            if model_path and os.path.isfile(model_path):
                try:
                    self.model = tf.keras.models.load_model(model_path)
                    logger.info(f"Loaded model from: {model_path}")
                except (IOError, ImportError) as err:
                    logger.error(f"Failed loading model at {model_path}: {err}")
                    self.model = self._build_model()
                    logger.info("Initialized new model due to load failure.")
            else:
                self.model = self._build_model()
                logger.info("Initialized new model.")

    def _build_model(self) -> tf.keras.Model:
        inputs = layers.Input(shape=(*IMG_SIZE, 1))

        x = layers.Conv2D(32, (3, 3), activation='relu', padding='same')(inputs)
        x = layers.MaxPooling2D((2, 2))(x)

        x = layers.Conv2D(64, (3, 3), activation='relu', padding='same')(x)
        x = layers.MaxPooling2D((2, 2))(x)

        x = layers.Conv2D(128, (3, 3), activation='relu', padding='same')(x)
        x = layers.MaxPooling2D((2, 2))(x)

        x = layers.Flatten()(x)
        x = layers.Dense(256, activation='relu')(x)
        x = layers.Dropout(0.5)(x)
        outputs = layers.Dense(NUM_CLASSES, activation='softmax')(x)

        model = models.Model(inputs, outputs)
        model.compile(
            optimizer=optimizers.Adam(learning_rate=1e-4),
            loss='categorical_crossentropy',
            metrics=['accuracy']
        )
        logger.info("CNN model built and compiled.")
        return model

    def preprocess_image(self, ct_scan_image: np.ndarray) -> np.ndarray:
        if not isinstance(ct_scan_image, np.ndarray):
            logger.error(f"Input image must be a numpy array, got {type(ct_scan_image)}.")
            raise ValueError("Input image must be a numpy array")

        if ct_scan_image.ndim not in {2, 3}:
            logger.error("Input image must be 2D grayscale or 3D with channels.")
            raise ValueError("Input image must be 2D grayscale or 3D with channels")

        # Convert to grayscale if needed
        if ct_scan_image.ndim == 3 and ct_scan_image.shape[2] != 1:
            ct_scan_image = cv2.cvtColor(ct_scan_image, cv2.COLOR_BGR2GRAY)

        # Normalize pixel intensity to [0,1]
        ct_norm = cv2.normalize(ct_scan_image, None, alpha=0, beta=1,
                                norm_type=cv2.NORM_MINMAX, dtype=cv2.CV_32F)

        # Resize for model input
        ct_resized = cv2.resize(ct_norm, IMG_SIZE, interpolation=cv2.INTER_AREA)

        # Expand dims for channel if needed
        preprocessed = np.expand_dims(ct_resized, axis=-1)
        logger.debug("Image preprocessing completed.")

        return preprocessed.astype(np.float32)

    def segment_arteries(self, ct_image: np.ndarray) -> np.ndarray:
        if not isinstance(ct_image, np.ndarray) or ct_image.ndim != 2:
            logger.error("Segmentation input must be 2D grayscale numpy array.")
            raise ValueError("Segmentation input must be 2D grayscale numpy array.")

        # Simple threshold-based segmentation for artery identification as placeholder
        # Typical Hounsfield units for blood vessels enhanced by contrast agent: ~ >150 HU
        _, binary_mask = cv2.threshold(ct_image, 150, 255, cv2.THRESH_BINARY)

        # Morphological operations to clean mask
        kernel = np.ones((5, 5), np.uint8)
        clean_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel)
        clean_mask = cv2.morphologyEx(clean_mask, cv2.MORPH_OPEN, kernel)

        logger.debug("Artery segmentation completed.")
        return clean_mask.astype(np.uint8)

    def classify_blockage(self, preprocessed_img: np.ndarray) -> Tuple[int, float]:
        if preprocessed_img.shape != (*IMG_SIZE, 1):
            logger.error(f"Invalid input shape for classification: {preprocessed_img.shape}")
            raise ValueError(f"Input image must have shape {(*IMG_SIZE, 1)}")

        with tf.device(self.device):
            try:
                img_batch = np.expand_dims(preprocessed_img, axis=0)
                preds = self.model.predict(img_batch, verbose=0)
                class_id = np.argmax(preds[0])
                confidence = float(np.max(preds[0]))
                logger.info(f"Prediction: class {class_id} with confidence {confidence:.4f}")
                return class_id, confidence
            except Exception as e:
                logger.error(f"Prediction failed: {e}")
                raise RuntimeError(f"Prediction failed: {e}")

    def infer(self, ct_scan_image: np.ndarray) -> dict:
        try:
            preprocessed = self.preprocess_image(ct_scan_image)

            # For interpretability, segment arteries from original CT slice (grayscale)
            if ct_scan_image.ndim == 3 and ct_scan_image.shape[2] != 1:
                gray_img = cv2.cvtColor(ct_scan_image, cv2.COLOR_BGR2GRAY)
            elif ct_scan_image.ndim == 2:
                gray_img = ct_scan_image
            else:
                gray_img = np.squeeze(ct_scan_image)

            artery_mask = self.segment_arteries(gray_img)

            class_id, confidence = self.classify_blockage(preprocessed)

            severity_levels = {
                0: "no_blockage",
                1: "mild",
                2: "moderate",
                3: "severe"
            }

            result = {
                "severity": severity_levels.get(class_id, "unknown"),
                "confidence_score": confidence,
                "artery_segmentation_mask": artery_mask
            }
            logger.info(f"Inference result: {result['severity']} (confidence {confidence:.3f})")
            return result
        except Exception as e:
            logger.error(f"Inference error: {e}")
            raise

    def save_model(self, path: str) -> None:
        try:
            self.model.save(path)
            logger.info(f"Model saved at {path}")
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            raise

```