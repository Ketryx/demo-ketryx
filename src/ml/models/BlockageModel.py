```python
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torchvision import transforms


class BlockageModel(nn.Module):
    def __init__(self, sensitivity=0.5, device=None):
        super(BlockageModel, self).__init__()

        # Sensitivity threshold for detection confidence
        self.sensitivity = sensitivity

        # Device management
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        # CNN architecture for 3D CT scan blockage detection
        # Example 3D CNN backbone
        self.features = nn.Sequential(
            nn.Conv3d(1, 32, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm3d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=2, stride=2),

            nn.Conv3d(32, 64, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm3d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool3d(kernel_size=2, stride=2),

            nn.Conv3d(64, 128, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm3d(128),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool3d(1)  # Output: batch x 128 x 1 x 1 x 1
        )

        # Classifier head outputs blockage probability map
        # Here predicting a voxel-wise map at a lower resolution
        # Adjust output channels accordingly (e.g. 1 for binary classification voxelwise)
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128, 64),
            nn.ReLU(inplace=True),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )

        # Performance metrics state (simple counters)
        self.reset_metrics()

        self.to(self.device)

    def forward(self, x):
        """
        Forward pass.
        x: tensor of shape (B, 1, D, H, W) - single channel volumetric CT data
        returns: (B, 1) confidence scores per sample indicating blockage presence
        """
        x = self.features(x)
        x = self.classifier(x)
        return x

    def load_pretrained_model(self, path, strict=True):
        """
        Loads pretrained weights from a checkpoint file.

        Args:
            path (str): Path to the checkpoint file.
            strict (bool): Strict parameter for load_state_dict.
        """
        checkpoint = torch.load(path, map_location=self.device)
        if 'state_dict' in checkpoint:
            state_dict = checkpoint['state_dict']
        else:
            state_dict = checkpoint
        self.load_state_dict(state_dict, strict=strict)
        self.to(self.device)
        self.eval()

    @torch.no_grad()
    def predict(self, ct_image_tensor, sensitivity=None):
        """
        Predict blockage locations on CT image data.

        Args:
            ct_image_tensor (torch.Tensor): 5D tensor (1, 1, D, H, W), single volume batch.
            sensitivity (float, optional): Confidence threshold override.

        Returns:
            dict with keys:
                'blockage_locations' : list of voxel indices where blockage detected
                'confidences' : list of confidence scores corresponding to detections
        """
        self.eval()

        if sensitivity is None:
            threshold = self.sensitivity
        else:
            threshold = sensitivity

        ct_image_tensor = ct_image_tensor.to(self.device, dtype=torch.float32)
        if ct_image_tensor.dim() != 5 or ct_image_tensor.size(0) != 1 or ct_image_tensor.size(1) != 1:
            raise ValueError("Input tensor must have shape (1, 1, D, H, W)")

        confidence = self.forward(ct_image_tensor)  # (1,1)
        confidence_val = confidence.item()

        detections = {'blockage_locations': [], 'confidences': []}

        if confidence_val >= threshold:
            # Simplified: For this architecture, outputs a global confidence
            # To return locations, typically output would be a voxel-wise map,
            # but here we have global scalar. Adapted to return the entire volume index.

            # Here we could implement localization if model outputs voxelwise prediction.
            # For now, return an empty list or the center voxel.

            D, H, W = ct_image_tensor.shape[2:]
            center_voxel = (D // 2, H // 2, W // 2)

            detections['blockage_locations'].append(center_voxel)
            detections['confidences'].append(confidence_val)

        # Update metrics
        self._update_metrics(predicted=confidence_val >= threshold)

        return detections

    def set_sensitivity(self, sensitivity):
        """
        Sets a new sensitivity threshold.

        Args:
            sensitivity (float): New confidence threshold value.
        """
        if not (0 <= sensitivity <= 1):
            raise ValueError("Sensitivity must be between 0 and 1.")
        self.sensitivity = sensitivity

    def _update_metrics(self, predicted):
        """
        Updates internal performance metrics counter.
        Here is a stub for demonstration.

        Args:
            predicted (bool): Prediction positive or negative.
        """
        self.total_predictions += 1
        if predicted:
            self.positive_predictions += 1

    def reset_metrics(self):
        """
        Resets tracked performance metrics counters.
        """
        self.total_predictions = 0
        self.positive_predictions = 0

    def get_metrics(self):
        """
        Returns current performance metrics summary.

        Returns:
            dict with metrics values
        """
        if self.total_predictions == 0:
            positive_ratio = 0.0
        else:
            positive_ratio = self.positive_predictions / self.total_predictions

        return {
            "total_predictions": self.total_predictions,
            "positive_predictions": self.positive_predictions,
            "positive_ratio": positive_ratio,
        }
```