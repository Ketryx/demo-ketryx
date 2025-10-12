```python
import numpy as np
from scipy.spatial.distance import cdist
from collections import defaultdict


class BlockageFilter:
    def __init__(
        self,
        confidence_threshold=0.5,
        nms_iou_threshold=0.3,
        severity_thresholds=(0.6, 0.85),
        clustering_distance=20,
    ):
        self.confidence_threshold = confidence_threshold
        self.nms_iou_threshold = nms_iou_threshold
        self.mild_threshold, self.severe_threshold = severity_thresholds
        self.clustering_distance = clustering_distance

    def filter_detections(self, detections):
        """
        Filter detections by confidence threshold.
        Each detection is dict with keys: 'bbox' (x1,y1,x2,y2), 'confidence', 'location', 'severity_score'
        Returns filtered list.
        """
        return [det for det in detections if det["confidence"] >= self.confidence_threshold]

    def non_maximum_suppression(self, detections):
        """
        Perform NMS to remove overlapping detections.
        """
        if not detections:
            return []

        boxes = np.array([det["bbox"] for det in detections])
        scores = np.array([det["confidence"] for det in detections])

        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]

        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)

            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1 + 1)
            h = np.maximum(0.0, yy2 - yy1 + 1)

            inter = w * h
            iou = inter / (areas[i] + areas[order[1:]] - inter)

            inds = np.where(iou <= self.nms_iou_threshold)[0]
            order = order[inds + 1]

        return [detections[i] for i in keep]

    def anatomical_plausibility(self, detection):
        """
        Check if detection location is anatomically plausible.
        Expected keys in detection: 'location' (str), 'bbox' (list)
        Example plausible locations: ['left_main', 'right_main', 'proximal_lad', 'mid_lad', 'distal_lad', 'lcx']
        Unplausible: detections far outside image bounds or at strange locations.
        """
        plausible_locations = {
            "left_main",
            "right_main",
            "proximal_lad",
            "mid_lad",
            "distal_lad",
            "lcx",
            "ramus",
            "obtuse_marginal",
            "posterior_descending",
        }
        loc = detection.get("location", None)
        if loc not in plausible_locations:
            return False
        bbox = detection["bbox"]
        if not self._bbox_within_image(bbox):
            return False
        return True

    def _bbox_within_image(self, bbox, image_size=(1024, 1024)):
        x1, y1, x2, y2 = bbox
        width, height = image_size
        if x1 < 0 or y1 < 0 or x2 > width or y2 > height:
            return False
        if x2 <= x1 or y2 <= y1:
            return False
        return True

    def classify_severity(self, detection):
        """
        Categorize blockage severity based on severity_score.
        severity_score: float [0,1] where higher is more severe.
        Return string: 'mild', 'moderate', 'severe'
        """
        score = detection.get("severity_score", 0)
        if score < self.mild_threshold:
            return "mild"
        elif score < self.severe_threshold:
            return "moderate"
        else:
            return "severe"

    def cluster_detections(self, detections):
        """
        Spatially cluster detections based on bbox center distances.
        Return list of clusters: each is list of detection indices.
        """
        if not detections:
            return []

        centers = np.array(
            [
                [
                    (det["bbox"][0] + det["bbox"][2]) / 2,
                    (det["bbox"][1] + det["bbox"][3]) / 2,
                ]
                for det in detections
            ]
        )

        clusters = []
        unassigned = set(range(len(detections)))

        while unassigned:
            current = unassigned.pop()
            cluster = {current}

            dist = cdist(centers[[current]], centers[list(unassigned)])[0]
            neighbors = {i for i, d in zip(list(unassigned), dist) if d <= self.clustering_distance}

            while neighbors:
                n = neighbors.pop()
                if n in unassigned:
                    unassigned.remove(n)
                    cluster.add(n)

                    dist_next = cdist(centers[[n]], centers[list(unassigned)])[0]
                    new_neighbors = {i for i, d in zip(list(unassigned), dist_next) if d <= self.clustering_distance}
                    neighbors.update(new_neighbors)

            clusters.append(sorted(cluster))

        return clusters

    def false_positive_reduction(self, detections):
        """
        Apply clinical rules to reduce false positives.
        Example rules:
          - Ignore mild detections in locations rarely afflicted clinically (e.g. ramus) unless confidence > 0.75
          - Ignore detections with bounding box area below min threshold (likely noise/artifact)
          - Check anatomical compatibility
        """
        filtered = []
        min_area = 50 * 50  # minimum area in pixels

        rare_locations = {"ramus", "obtuse_marginal"}

        for det in detections:
            bbox = det["bbox"]
            area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
            if area < min_area:
                continue
            severity = self.classify_severity(det)
            location = det.get("location", "")
            if (
                severity == "mild"
                and location in rare_locations
                and det["confidence"] < 0.75
            ):
                continue
            if not self.anatomical_plausibility(det):
                continue
            filtered.append(det)
        return filtered

    def validate_results(self, detections):
        """
        Validate final detection results.
        Enforce safety constraints:
          - No overlapping severe detections in same artery segment
          - Total number of severe detections should not exceed realistic max (e.g. 5)
          - Ensure presence of at least one plausible detection for positive cases
        """
        severe_dets = [d for d in detections if self.classify_severity(d) == "severe"]

        # Check maximum severe blockage count
        if len(severe_dets) > 5:
            raise ValueError(
                f"Too many severe blockages detected ({len(severe_dets)}), exceeding clinical expectation."
            )

        # Check overlapping severe detections in same artery segment (based on bbox IoU)
        def iou(boxA, boxB):
            xA = max(boxA[0], boxB[0])
            yA = max(boxA[1], boxB[1])
            xB = min(boxA[2], boxB[2])
            yB = min(boxA[3], boxB[3])
            interArea = max(0, xB - xA + 1) * max(0, yB - yA + 1)
            boxAArea = (boxA[2] - boxA[0] + 1) * (boxA[3] - boxA[1] + 1)
            boxBArea = (boxB[2] - boxB[0] + 1) * (boxB[3] - boxB[1] + 1)
            return interArea / float(boxAArea + boxBArea - interArea)

        for i in range(len(severe_dets)):
            for j in range(i + 1, len(severe_dets)):
                iou_val = iou(severe_dets[i]["bbox"], severe_dets[j]["bbox"])
                if iou_val > 0.1:
                    same_segment = (
                        severe_dets[i].get("location") == severe_dets[j].get("location")
                    )
                    if same_segment:
                        raise ValueError(
                            f"Overlapping severe detections in same artery segment: {severe_dets[i]['location']}"
                        )

        # Optionally: check that detections are present if model is positive
        if len(detections) == 0:
            # Depending on clinical safety policy, could warn or raise exception
            pass

        return True

    def process(self, detections):
        """
        Run full postprocessing pipeline on raw detections.
        Arguments:
          detections: list of dicts with keys:
            - bbox: [x1,y1,x2,y2]
            - confidence: float
            - location: str
            - severity_score: float [0,1]

        Returns:
          list of postprocessed detection dicts with added 'severity' key.
        """
        filtered = self.filter_detections(detections)
        nmsed = self.non_maximum_suppression(filtered)
        clinically_filtered = self.false_positive_reduction(nmsed)
        validated = self.validate_results(clinically_filtered)

        for det in clinically_filtered:
            det["severity"] = self.classify_severity(det)

        clusters = self.cluster_detections(clinically_filtered)

        return {"detections": clinically_filtered, "clusters": clusters}
```