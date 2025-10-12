```python
import os
import random
import logging
from datetime import datetime
from typing import Dict, Any, Tuple, List

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Subset
from torch.utils.tensorboard import SummaryWriter
from torchvision import transforms
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import roc_auc_score, confusion_matrix

from src.ml.data.BlockageDataset import BlockageDataset
from src.ml.model.BlockageModel import BlockageModel

# Fix seeds for reproducibility
def set_seed(seed: int = 42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


class ModelTrainer:
    def __init__(
        self,
        data_dir: str,
        checkpoint_dir: str,
        logs_dir: str,
        num_epochs: int = 50,
        batch_size: int = 16,
        learning_rate: float = 1e-4,
        num_folds: int = 5,
        device: str = None,
        seed: int = 42,
    ):
        set_seed(seed)
        self.data_dir = data_dir
        self.checkpoint_dir = checkpoint_dir
        self.logs_dir = logs_dir
        os.makedirs(checkpoint_dir, exist_ok=True)
        os.makedirs(logs_dir, exist_ok=True)

        self.num_epochs = num_epochs
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        self.num_folds = num_folds
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.seed = seed

        self.logger = self._init_logger()
        self.writer = SummaryWriter(logs_dir)

        self._init_transforms()
        self.dataset = BlockageDataset(data_dir=self.data_dir, transform=self.train_transform)

    def _init_logger(self):
        logger = logging.getLogger("ModelTrainer")
        logger.setLevel(logging.DEBUG)
        ch = logging.StreamHandler()
        ch.setLevel(logging.DEBUG)
        formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
        ch.setFormatter(formatter)
        logger.addHandler(ch)
        return logger

    def _init_transforms(self):
        # Data augmentation for robust training in medical imaging
        self.train_transform = transforms.Compose(
            [
                transforms.RandomRotation(degrees=10),
                transforms.RandomResizedCrop(size=224, scale=(0.9, 1.1)),
                transforms.RandomHorizontalFlip(p=0.5),
                transforms.RandomVerticalFlip(p=0.1),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485], std=[0.229]),
            ]
        )
        self.val_transform = transforms.Compose(
            [
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485], std=[0.229]),
            ]
        )

    def _loss_function(self):
        # Combination of BCEWithLogitsLoss and Dice Loss for medical binary segmentation-like setup
        class DiceLoss(nn.Module):
            def __init__(self, smooth=1.0):
                super(DiceLoss, self).__init__()
                self.smooth = smooth

            def forward(self, logits, targets):
                probs = torch.sigmoid(logits)
                probs_flat = probs.view(-1)
                targets_flat = targets.view(-1)
                intersection = (probs_flat * targets_flat).sum()
                dice = (2.0 * intersection + self.smooth) / (
                    probs_flat.sum() + targets_flat.sum() + self.smooth
                )
                return 1 - dice

        bce = nn.BCEWithLogitsLoss()
        dice = DiceLoss()

        def combined_loss(logits, targets):
            return bce(logits, targets) + dice(logits, targets)

        return combined_loss

    def _compute_metrics(self, outputs: torch.Tensor, targets: torch.Tensor) -> Dict[str, float]:
        probs = torch.sigmoid(outputs).cpu().detach().numpy()
        targets_np = targets.cpu().detach().numpy()

        preds = (probs >= 0.5).astype(int)
        tn, fp, fn, tp = confusion_matrix(targets_np, preds).ravel()

        sensitivity = tp / (tp + fn) if (tp + fn) > 0 else 0.0  # Recall
        specificity = tn / (tn + fp) if (tn + fp) > 0 else 0.0
        auc = roc_auc_score(targets_np, probs)

        return {"sensitivity": sensitivity, "specificity": specificity, "auc": auc}

    def _train_one_epoch(
        self,
        model: nn.Module,
        optimizer: torch.optim.Optimizer,
        criterion,
        dataloader: DataLoader,
    ) -> Tuple[float, Dict[str, float]]:
        model.train()
        running_loss = 0.0
        all_outputs = []
        all_targets = []

        for inputs, targets in dataloader:
            inputs = inputs.to(self.device)
            targets = targets.float().to(self.device).unsqueeze(1)

            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * inputs.size(0)
            all_outputs.append(outputs)
            all_targets.append(targets)

        epoch_loss = running_loss / len(dataloader.dataset)
        all_outputs_tensor = torch.cat(all_outputs)
        all_targets_tensor = torch.cat(all_targets)
        metrics = self._compute_metrics(all_outputs_tensor, all_targets_tensor)

        return epoch_loss, metrics

    def _validate_one_epoch(
        self,
        model: nn.Module,
        criterion,
        dataloader: DataLoader,
    ) -> Tuple[float, Dict[str, float]]:
        model.eval()
        running_loss = 0.0
        all_outputs = []
        all_targets = []
        with torch.no_grad():
            for inputs, targets in dataloader:
                inputs = inputs.to(self.device)
                targets = targets.float().to(self.device).unsqueeze(1)

                outputs = model(inputs)
                loss = criterion(outputs, targets)

                running_loss += loss.item() * inputs.size(0)
                all_outputs.append(outputs)
                all_targets.append(targets)

        epoch_loss = running_loss / len(dataloader.dataset)
        all_outputs_tensor = torch.cat(all_outputs)
        all_targets_tensor = torch.cat(all_targets)
        metrics = self._compute_metrics(all_outputs_tensor, all_targets_tensor)

        return epoch_loss, metrics

    def _save_checkpoint(
        self,
        model: nn.Module,
        optimizer: torch.optim.Optimizer,
        fold: int,
        epoch: int,
        metrics: Dict[str, float],
    ):
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filename = f"blockage_model_fold{fold}_epoch{epoch}_{timestamp}.pt"
        path = os.path.join(self.checkpoint_dir, filename)

        torch.save(
            {
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "epoch": epoch,
                "metrics": metrics,
                "seed": self.seed,
            },
            path,
        )
        self.logger.info(f"Saved checkpoint: {path}")

    def _hyperparameter_search(
        self, param_grid: Dict[str, List[Any]]
    ) -> Dict[str, Any]:
        best_auc = 0.0
        best_params = {}
        self.logger.info("Starting hyperparameter tuning...")

        from itertools import product

        combinations = list(product(*param_grid.values()))
        keys = list(param_grid.keys())

        for combo in combinations:
            params = dict(zip(keys, combo))
            self.logger.info(f"Testing params: {params}")

            avg_auc = self._cross_validate(params)
            self.logger.info(f"Params: {params} - Avg AUC: {avg_auc:.4f}")

            if avg_auc > best_auc:
                best_auc = avg_auc
                best_params = params

        self.logger.info(f"Best params found: {best_params} with AUC: {best_auc:.4f}")
        return best_params

    def _cross_validate(self, training_params: Dict[str, Any]) -> float:
        skf = StratifiedKFold(n_splits=self.num_folds, shuffle=True, random_state=self.seed)
        targets = self.dataset.targets  # assume dataset exposes targets attribute: List[int]
        aucs = []

        for fold, (train_idx, val_idx) in enumerate(skf.split(np.zeros(len(targets)), targets)):
            train_subset = Subset(self.dataset, train_idx)
            val_subset = Subset(self.dataset, val_idx)

            train_subset.dataset.transform = self.train_transform
            val_subset.dataset.transform = self.val_transform

            train_loader = DataLoader(
                train_subset, batch_size=training_params.get("batch_size", self.batch_size), shuffle=True, num_workers=4
            )
            val_loader = DataLoader(
                val_subset, batch_size=training_params.get("batch_size", self.batch_size), shuffle=False, num_workers=4
            )

            model = BlockageModel().to(self.device)
            optimizer = optim.Adam(
                model.parameters(), lr=training_params.get("learning_rate", self.learning_rate)
            )
            criterion = self._loss_function()

            best_val_auc = 0.0
            patience = 5
            wait = 0

            for epoch in range(training_params.get("num_epochs", self.num_epochs)):
                self._train_one_epoch(model, optimizer, criterion, train_loader)
                val_loss, val_metrics = self._validate_one_epoch(model, criterion, val_loader)

                if val_metrics["auc"] > best_val_auc:
                    best_val_auc = val_metrics["auc"]
                    wait = 0
                else:
                    wait += 1
                    if wait >= patience:
                        break

            aucs.append(best_val_auc)
            self.logger.info(f"Fold {fold + 1}/{self.num_folds} - Best Val AUC: {best_val_auc:.4f}")

        avg_auc = np.mean(aucs)
        return avg_auc

    def train(self, hyperparam_tuning: bool = True):
        if hyperparam_tuning:
            param_grid = {
                "learning_rate": [1e-3, 1e-4, 5e-5],
                "batch_size": [8, 16, 32],
                "num_epochs": [30, 50],
            }
            best_params = self._hyperparameter_search(param_grid)
        else:
            best_params = {
                "learning_rate": self.learning_rate,
                "batch_size": self.batch_size,
                "num_epochs": self.num_epochs,
            }

        self.logger.info(f"Start training with params: {best_params}")

        skf = StratifiedKFold(n_splits=self.num_folds, shuffle=True, random_state=self.seed)
        targets = self.dataset.targets

        for fold, (train_idx, val_idx) in enumerate(skf.split(np.zeros(len(targets)), targets)):
            self.logger.info(f"Training fold {fold + 1}/{self.num_folds}")
            train_subset = Subset(self.dataset, train_idx)
            val_subset = Subset(self.dataset, val_idx)

            train_subset.dataset.transform = self.train_transform
            val_subset.dataset.transform = self.val_transform

            train_loader = DataLoader(
                train_subset,
                batch_size=best_params["batch_size"],
                shuffle=True,
                num_workers=4,
                pin_memory=True,
            )
            val_loader = DataLoader(
                val_subset,
                batch_size=best_params["batch_size"],
                shuffle=False,
                num_workers=4,
                pin_memory=True,
            )

            model = BlockageModel().to(self.device)
            optimizer = optim.Adam(model.parameters(), lr=best_params["learning_rate"])
            criterion = self._loss_function()

            best_auc = 0.0
            patience = 7
            wait = 0

            history = {"train_loss": [], "val_loss": [], "val_sensitivity": [], "val_specificity": [], "val_auc": []}

            for epoch in range(best_params["num_epochs"]):
                train_loss, train_metrics = self._train_one_epoch(model, optimizer, criterion, train_loader)
                val_loss, val_metrics = self._validate_one_epoch(model, criterion, val_loader)

                history["train_loss"].append(train_loss)
                history["val_loss"].append(val_loss)
                history["val_sensitivity"].append(val_metrics["sensitivity"])
                history["val_specificity"].append(val_metrics["specificity"])
                history["val_auc"].append(val_metrics["auc"])

                self.logger.info(
                    f"Fold {fold + 1}, Epoch {epoch + 1}/{best_params['num_epochs']}: "
                    f"Train Loss={train_loss:.4f} | Val Loss={val_loss:.4f} | "
                    f"Val Sensitivity={val_metrics['sensitivity']:.4f} | "
                    f"Val Specificity={val_metrics['specificity']:.4f} | "
                    f"Val AUC={val_metrics['auc']:.4f}"
                )

                self.writer.add_scalar(f"Fold{fold+1}/Train/Loss", train_loss, epoch)
                self.writer.add_scalar(f"Fold{fold+1}/Val/Loss", val_loss, epoch)
                self.writer.add_scalar(f"Fold{fold+1}/Val/Sensitivity", val_metrics["sensitivity"], epoch)
                self.writer.add_scalar(f"Fold{fold+1}/Val/Specificity", val_metrics["specificity"], epoch)
                self.writer.add_scalar(f"Fold{fold+1}/Val/AUC", val_metrics["auc"], epoch)

                if val_metrics["auc"] > best_auc:
                    best_auc = val_metrics["auc"]
                    wait = 0
                    self._save_checkpoint(model, optimizer, fold, epoch + 1, val_metrics)
                else:
                    wait += 1
                    if wait >= patience:
                        self.logger.info(f"Early stopping triggered at epoch {epoch + 1}")
                        break

            # Save training history for the fold
            hist_path = os.path.join(
                self.logs_dir, f"training_history_fold{fold+1}_{datetime.now().strftime('%Y%m%d-%H%M%S')}.npz"
            )
            np.savez(hist_path, **history)
            self.logger.info(f"Saved training history at {hist_path}")

        self.writer.close()
```