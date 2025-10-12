```python
import os
import logging
from typing import List, Tuple, Optional, Union

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn
from torchvision import transforms

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BlockageDetector:
    """
    ML-based coronary artery blockage detector using PyTorch.
    Loads a trained model, preprocesses CT scan data, runs inference,
    applies sensitivity tuning and postprocessing, and supports integration with 3D coronary models.
    """

    SUPPORTED_VERSIONS = {'v1', 'v2'}

    def __init__(
        self,
        model_path: str,
        device: Optional[Union[str, torch.device]] = None,
        model_version: str = 'v1',
        detection_threshold: float = 0.5,
        sensitivity: float = 1.0,
    ):
        """
        Initialize the blockage detector by loading the trained model.

        Args:
            model_path (str): Path to the saved PyTorch model (.pt or .pth file).
            device (str or torch.device): Device for model inference ('cpu' or 'cuda').
            model_version (str): Version of the model for compatibility checks.
            detection_threshold (float): Base confidence threshold for detections [0..1].
            sensitivity (float): Multiplier to adjust detection_threshold (higher -> more sensitive).
        """
        if model_version not in self.SUPPORTED_VERSIONS:
            raise ValueError(f"Unsupported model_version '{model_version}'. Supported: {self.SUPPORTED_VERSIONS}")
        self.model_version = model_version

        self.device = torch.device(device or ('cuda' if torch.cuda.is_available() else 'cpu'))
        self.detection_threshold = detection_threshold
        self.sensitivity = sensitivity

        self.model = self._load_model(model_path)

        # Define preprocessing transform - example assumes CT scan in Hounsfield units
        self.preprocess_transform = transforms.Compose([
            transforms.ToTensor(),  # convert np.ndarray to tensor
            transforms.Lambda(lambda x: (x - x.min()) / (x.max() - x.min() + 1e-8)),  # normalize to [0,1]
            transforms.Resize((128, 128)),  # resize for model compatibility
        ])

    def _load_model(self, model_path: str) -> nn.Module:
        """
        Loads the PyTorch model from given path with error handling and version checks.

        Args:
            model_path (str): Path to the saved model.

        Returns:
            nn.Module: Loaded PyTorch model.
        """
        if not os.path.isfile(model_path):
            raise FileNotFoundError(f"Model file not found at {model_path}")

        try:
            checkpoint = torch.load(model_path, map_location=self.device)
            model_state = checkpoint.get('model_state_dict', checkpoint)
            version = checkpoint.get('model_version', 'unknown')
            if version != self.model_version:
                logger.warning(f"Loaded model version '{version}' differs from requested '{self.model_version}'")

            model = self._build_model()
            model.load_state_dict(model_state)
            model.to(self.device)
            model.eval()
            logger.info(f"Model loaded successfully from {model_path}")
            return model

        except Exception as e:
            logger.error(f"Error loading model: {e}")
            raise RuntimeError(f"Failed to load model from {model_path}: {e}")

    def _build_model(self) -> nn.Module:
        """
        Constructs the model architecture according to the model version.

        Returns:
            nn.Module: Initialized model architecture.
        """
        # Placeholder: Define or import your model architecture here based on version

        class SimpleCNN(nn.Module):
            def __init__(self):
                super().__init__()
                self.features = nn.Sequential(
                    nn.Conv2d(1, 16, 3, padding=1),
                    nn.ReLU(),
                    nn.MaxPool2d(2),
                    nn.Conv2d(16, 32, 3, padding=1),
                    nn.ReLU(),
                    nn.MaxPool2d(2),
                    nn.Conv2d(32, 64, 3, padding=1),
                    nn.ReLU(),
                    nn.AdaptiveAvgPool2d(1),
                )
                self.classifier = nn.Linear(64, 2)  # output: [background, blockage]

            def forward(self, x):
                x = self.features(x)
                x = torch.flatten(x, 1)
                x = self.classifier(x)
                return x

        # Extend this method to support different versions if needed
        if self.model_version == 'v1':
            return SimpleCNN()
        elif self.model_version == 'v2':
            # hypothetical improved model architecture
            model = SimpleCNN()
            # ... apply any changes specific to v2 here ...
            return model

        raise NotImplementedError(f"Model architecture not implemented for version {self.model_version}")

    def preprocess(self, ct_slice: np.ndarray) -> torch.Tensor:
        """
        Preprocesses a single 2D CT scan slice for model input.

        Args:
            ct_slice (np.ndarray): 2D array representing a CT scan slice (Hounsfield units).

        Returns:
            torch.Tensor: Preprocessed tensor ready for inference (1, 1, H, W).
        """
        if not isinstance(ct_slice, np.ndarray):
            raise TypeError("Input ct_slice must be a numpy ndarray")

        if ct_slice.ndim != 2:
            raise ValueError("Input ct_slice must be a 2D array")

        try:
            img_tensor = self.preprocess_transform(ct_slice)
            # Ensure batch and channel dimensions
            if img_tensor.ndim == 2:
                img_tensor = img_tensor.unsqueeze(0)  # add channel dim
            if img_tensor.ndim == 3:
                img_tensor = img_tensor.unsqueeze(0)  # add batch dim
            return img_tensor.to(self.device)
        except Exception as e:
            logger.error(f"Error during preprocessing: {e}")
            raise RuntimeError(f"Preprocessing failed: {e}")

    def infer(self, preprocessed_tensor: torch.Tensor) -> Tuple[List[Tuple[int, int, float]], torch.Tensor]:
        """
        Runs inference on preprocessed CT data to detect blockages.

        Args:
            preprocessed_tensor (torch.Tensor): Batched input tensor (B, C, H, W).

        Returns:
            Tuple[List[Tuple[int, int, float]], torch.Tensor]: 
                - List of detected blockages as (x, y, confidence_score),
                - Raw confidence map tensor (B, 2, H, W) or logits
        """
        if not isinstance(preprocessed_tensor, torch.Tensor):
            raise TypeError("Input must be a torch.Tensor")

        with torch.no_grad():
            logits = self.model(preprocessed_tensor)
            # Assuming model outputs classification logits per image (global)
            probs = F.softmax(logits, dim=1)  # (B, 2)

            # This example assumes whole image classification; 
            # to detect positions, change model and output accordingly.

            detections = []
            for batch_idx, prob in enumerate(probs):
                blockage_conf = prob[1].item()  # index 1 = blockage class
                if blockage_conf >= self.detection_threshold * self.sensitivity:
                    # Placeholder coordinates: real model should output locations
                    detections.append((batch_idx, 0, blockage_conf))
            
            return detections, probs

    def postprocess(
        self,
        detections: List[Tuple[int, int, float]],
        min_confidence: Optional[float] = None,
    ) -> List[Tuple[int, int, float]]:
        """
        Filters detected blockages to reduce false positives based on confidence thresholds.

        Args:
            detections (List[Tuple[int, int, float]]): Raw detections.
            min_confidence (float, optional): Minimum confidence to keep a detection.

        Returns:
            List[Tuple[int, int, float]]: Filtered detections.
        """
        threshold = min_confidence or (self.detection_threshold * self.sensitivity)
        filtered = [det for det in detections if det[2] >= threshold]
        logger.debug(f"Filtered {len(detections)-len(filtered)} false positives below threshold {threshold:.2f}")
        return filtered

    def integrate_with_3d_model(
        self,
        detections: List[Tuple[int, int, float]],
        coronary_3d_model: dict,
    ) -> List[dict]:
        """
        Integrates detection results with 3D coronary artery models.

        Args:
            detections (List[Tuple[int, int, float]]): Detected blockage candidates.
            coronary_3d_model (dict): Representation of 3D coronary artery model.

        Returns:
            List[dict]: Blockages localized within 3D model context with metadata.
        """
        # This method is domain-specific and requires coronary_3d_model format details.
        # Example placeholder implementation:
        integrated_results = []
        try:
            for det in detections:
                slice_idx, _, conf = det
                # Map 2D slice detection to 3D coordinates (placeholder logic)
                model_coords = coronary_3d_model.get('slices', {}).get(slice_idx, None)
                if model_coords is None:
                    logger.warning(f"No 3D data for slice index {slice_idx}; skipping integration.")
                    continue
                blockage_info = {
                    'slice_index': slice_idx,
                    '3d_coordinates': model_coords,
                    'confidence': conf,
                }
                integrated_results.append(blockage_info)
        except Exception as e:
            logger.error(f"Error during integration with 3D model: {e}")
            raise RuntimeError(f"Integration failed: {e}")

        return integrated_results

    def set_sensitivity(self, sensitivity: float):
        """
        Adjust detection sensitivity by changing the confidence thresholds.

        Args:
            sensitivity (float): Multiplier to alter detection threshold (>0).

        Raises:
            ValueError: If sensitivity is not positive.
        """
        if sensitivity <= 0:
            raise ValueError("Sensitivity must be a positive float")
        self.sensitivity = sensitivity
        logger.info(f"Detection sensitivity set to {self.sensitivity}")

```