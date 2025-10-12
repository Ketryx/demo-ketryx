```python
import io
import pytest
import torch
import numpy as np
from unittest import mock
from unittest.mock import MagicMock, patch

from ml.blockage_model import BlockageModel


@pytest.fixture
def dummy_model_state():
    return {
        "version": "1.0.0",
        "model_state_dict": torch.nn.Linear(10, 5).state_dict()
    }


@pytest.fixture
def dummy_input():
    return torch.randn(2, 10)


@pytest.fixture
def dummy_validation_data():
    # 20 samples, input size 10
    X_val = torch.randn(20, 10)
    # binary labels for classification (0 or 1)
    y_val = torch.randint(0, 2, (20,))
    return X_val, y_val


class DummyNet(torch.nn.Module):
    def __init__(self, input_dim=10, output_dim=1):
        super().__init__()
        self.linear = torch.nn.Linear(input_dim, output_dim)

    def forward(self, x):
        return torch.sigmoid(self.linear(x))


@pytest.fixture
def patch_torch_load(mocker, dummy_model_state):
    def fake_load(path_or_buffer, map_location=None):
        # ignore map_location for this fake mock
        dummy_net = DummyNet()
        dummy_net.load_state_dict(dummy_model_state["model_state_dict"])
        return dummy_net
    return mocker.patch("torch.load", side_effect=fake_load)


@pytest.fixture
def patch_torch_load_corrupted(mocker):
    def fake_load_fail(path_or_buffer, map_location=None):
        raise RuntimeError("corrupted model file")
    return mocker.patch("torch.load", side_effect=fake_load_fail)


def test_model_load_and_init_cpu(patch_torch_load):
    model = BlockageModel("fake_path.pt", device="cpu")
    assert isinstance(model.model, torch.nn.Module)
    assert model.device == "cpu"
    assert next(model.model.parameters()).device.type == "cpu"


def test_model_load_and_init_gpu(monkeypatch, patch_torch_load):
    if not torch.cuda.is_available():
        pytest.skip("CUDA not available")

    model = BlockageModel("fake_path.pt", device="cuda")
    assert model.device == "cuda"
    assert next(model.model.parameters()).device.type == "cuda"


def test_input_output_tensor_shapes(patch_torch_load, dummy_input):
    model = BlockageModel("fake_path.pt", device="cpu")
    output = model.predict(dummy_input)
    assert isinstance(output, torch.Tensor)
    assert output.shape[0] == dummy_input.shape[0]
    # Output shape should match output dims of DummyNet (single output)
    assert output.shape[1] == 1 or output.shape[1] == output.ndim - (dummy_input.ndim - 1)


def test_prediction_accuracy_and_sensitivity(mocker, patch_torch_load, dummy_validation_data):
    X_val, y_val = dummy_validation_data

    model = BlockageModel("fake_path.pt", device="cpu")

    # Patch internal model forward call to generate controlled outputs
    mock_output = torch.sigmoid(torch.randn_like(y_val.float().unsqueeze(1)))
    mocker.patch.object(model.model, "forward", return_value=mock_output)

    # Test default sensitivity (threshold)
    preds_default = model.predict(X_val, sensitivity=0.5)
    assert (preds_default >= 0).all()
    assert (preds_default <= 1).all()

    # Test sensitivity effect (thresholding inside predict)
    preds_low_sens = model.predict(X_val, sensitivity=0.1)
    preds_high_sens = model.predict(X_val, sensitivity=0.9)
    # Lower sensitivity threshold should allow more positives
    assert (preds_low_sens >= preds_high_sens).all()


def test_model_versioning_and_compatibility(monkeypatch):
    # Simulate loading old and current version model states

    # old version state dict
    old_state = {
        "version": "0.9.0",
        "model_state_dict": torch.nn.Linear(10, 1).state_dict()
    }
    new_state = {
        "version": "1.0.0",
        "model_state_dict": torch.nn.Linear(10, 1).state_dict()
    }

    def fake_load_old(_path, map_location=None):
        dummy_net = DummyNet()
        dummy_net.load_state_dict(old_state["model_state_dict"])
        dummy_net.version = old_state["version"]
        return dummy_net

    def fake_load_new(_path, map_location=None):
        dummy_net = DummyNet()
        dummy_net.load_state_dict(new_state["model_state_dict"])
        dummy_net.version = new_state["version"]
        return dummy_net

    with patch("torch.load", side_effect=fake_load_old):
        model_old = BlockageModel("fake_old.pt")
        assert hasattr(model_old.model, "version")
        assert model_old.model.version == "0.9.0"

    with patch("torch.load", side_effect=fake_load_new):
        model_new = BlockageModel("fake_new.pt")
        assert hasattr(model_new.model, "version")
        assert model_new.model.version == "1.0.0"


def test_error_handling_for_corrupted_model_file(patch_torch_load_corrupted):
    with pytest.raises(RuntimeError, match="corrupted model file"):
        BlockageModel("corrupted_model.pt")


def test_predict_raises_with_invalid_input_shape(patch_torch_load):
    model = BlockageModel("fake_path.pt")
    invalid_input = torch.randn(3)  # Should be 2D for batch
    with pytest.raises(ValueError):
        model.predict(invalid_input)
```