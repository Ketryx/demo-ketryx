```cpp
#include "VesselSegmenter.h"

#include <opencv2/imgproc.hpp>
#include <opencv2/core.hpp>
#include <queue>
#include <vector>
#include <cmath>

namespace modeling {
namespace segmentation {

// Helper struct to define 3D points
struct Point3D {
    int x, y, z;
    Point3D(int _x, int _y, int _z) : x(_x), y(_y), z(_z) {}
};

VesselSegmenter::VesselSegmenter(float lowerThreshold, float upperThreshold, int regionGrowConnectivity)
    : m_lowerThreshold(lowerThreshold),
      m_upperThreshold(upperThreshold),
      m_regionGrowConnectivity(regionGrowConnectivity)
{}

void VesselSegmenter::setIntensityThresholds(float lower, float upper) {
    m_lowerThreshold = lower;
    m_upperThreshold = upper;
}

void VesselSegmenter::setRegionGrowingConnectivity(int connectivity) {
    m_regionGrowConnectivity = connectivity;
}

void VesselSegmenter::segment(const cv::Mat& inputVolume) {
    CV_Assert(inputVolume.dims == 3);
    m_inputVolume = inputVolume.clone();
    m_segmentation = cv::Mat::zeros(inputVolume.size, CV_8U);

    intensityThresholding();
    regionGrowing();
    morphologicalRefinement();
    multiScaleProcessing();
    extractCenterlines();
    detectBranchPoints();
    filterFalsePositives();
}

const cv::Mat& VesselSegmenter::getSegmentation() const {
    return m_segmentation;
}

std::vector<Point3D> VesselSegmenter::getCenterlines() const {
    return m_centerlines;
}

std::vector<Point3D> VesselSegmenter::getBranchPoints() const {
    return m_branchPoints;
}

void VesselSegmenter::intensityThresholding() {
    // Threshold input volume to identify candidate vessel voxels
    const int* sizes = m_inputVolume.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];
    for (int z = 0; z < depth; ++z) {
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                float v = m_inputVolume.at<float>(z, y, x);
                if (v >= m_lowerThreshold && v <= m_upperThreshold) {
                    m_segmentation.at<uchar>(z,y,x) = 255;
                }
            }
        }
    }
}

void VesselSegmenter::regionGrowing() {
    // Refine segmentation by region growing from seed voxels
    // Identify seed points: local maxima in thresholded volume
    const int* sizes = m_segmentation.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    cv::Mat visited = cv::Mat::zeros(m_segmentation.size, CV_8U);

    int dx[6]{1,-1,0,0,0,0};
    int dy[6]{0,0,1,-1,0,0};
    int dz[6]{0,0,0,0,1,-1};

    for (int z = 1; z < depth - 1; ++z) {
        for (int y = 1; y < height - 1; ++y) {
            for (int x = 1; x < width - 1; ++x) {
                if (m_segmentation.at<uchar>(z,y,x) == 255 && !visited.at<uchar>(z,y,x)) {
                    // Region grow from this seed if it satisfies intensity conditions
                    regionGrowFromSeed(cv::Point3i(x,y,z), visited);
                }
            }
        }
    }
}

void VesselSegmenter::regionGrowFromSeed(const cv::Point3i& seed, cv::Mat& visited) {
    std::queue<cv::Point3i> q;
    q.push(seed);
    visited.at<uchar>(seed.z, seed.y, seed.x) = 1;

    int dx[6]{1,-1,0,0,0,0};
    int dy[6]{0,0,1,-1,0,0};
    int dz[6]{0,0,0,0,1,-1};

    const int* sizes = m_inputVolume.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    while(!q.empty()) {
        cv::Point3i p = q.front(); q.pop();
        float val = m_inputVolume.at<float>(p.z, p.y, p.x);

        // Confirm voxel intensity is within threshold
        if (val < m_lowerThreshold || val > m_upperThreshold) {
            m_segmentation.at<uchar>(p.z, p.y, p.x) = 0;
            continue;
        }
        m_segmentation.at<uchar>(p.z, p.y, p.x) = 255;

        for (int i = 0; i < m_regionGrowConnectivity; ++i) {
            int nx = p.x + dx[i];
            int ny = p.y + dy[i];
            int nz = p.z + dz[i];
            if (nx >= 0 && ny >= 0 && nz >= 0 &&
                nz < depth && ny < height && nx < width) {
                if (m_segmentation.at<uchar>(nz, ny, nx) == 255 && !visited.at<uchar>(nz, ny, nx)) {
                    visited.at<uchar>(nz, ny, nx) = 1;
                    q.push(cv::Point3i(nx, ny, nz));
                }
            }
        }
    }
}

void VesselSegmenter::morphologicalRefinement() {
    // Apply 3D morphological closing and opening to refine vessels
    // Approximate 3x3x3 structuring element with iterative 2D slices + cross-slice dilation

    const int* sizes = m_segmentation.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    // Create temp volume for morphological operations
    cv::Mat temp = m_segmentation.clone();

    // Perform 2D morphological close slice-wise z-wise
    for (int z = 0; z < depth; ++z) {
        cv::Mat slice(height, width, CV_8U, temp.ptr(z));
        cv::morphologyEx(slice, slice, cv::MORPH_CLOSE,
                         cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(3,3)));
        cv::morphologyEx(slice, slice, cv::MORPH_OPEN,
                         cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(3,3)));
    }

    // Approximate cross-slice dilation/erosion
    for (int iter = 0; iter < 2; ++iter) {
        cv::Mat dilated = temp.clone();
        for (int z = 1; z < depth -1; ++z) {
            uchar* curr = temp.ptr(z);
            uchar* prev = temp.ptr(z-1);
            uchar* next = temp.ptr(z+1);
            uchar* out = dilated.ptr(z);
            for (int i = 0; i < width * height; ++i) {
                out[i] = std::max({prev[i], curr[i], next[i]});
            }
        }
        temp = dilated;

        cv::Mat eroded = temp.clone();
        for (int z = 1; z < depth -1; ++z) {
            uchar* curr = temp.ptr(z);
            uchar* prev = temp.ptr(z-1);
            uchar* next = temp.ptr(z+1);
            uchar* out = eroded.ptr(z);
            for (int i = 0; i < width * height; ++i) {
                out[i] = std::min({prev[i], curr[i], next[i]});
            }
        }
        temp = eroded;
    }
    m_segmentation = temp;
}

void VesselSegmenter::extractCenterlines() {
    // Skeletonize the segmentation to extract centerlines using 3D thinning
    // We use a simple iterative thinning implementation until convergence

    const int* sizes = m_segmentation.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    cv::Mat current = m_segmentation.clone();
    cv::Mat prev;

    // Convert scale to binary (0 or 1)
    current /= 255;

    bool changed;
    do {
        changed = false;
        prev = current.clone();

        for(int z = 1; z < depth - 1; ++z) {
            for(int y = 1; y < height - 1; ++y) {
                for(int x = 1; x < width - 1; ++x) {
                    if(current.at<uchar>(z,y,x) == 1) {
                        int neighbors = countNeighbors(current, x, y, z);
                        if(neighbors >= 2 && neighbors <= 6) {
                            int transitions = countTransitions(current, x, y, z);
                            if(transitions == 1) {
                                if(!isEndpoint(current, x, y, z)) {
                                    current.at<uchar>(z,y,x) = 0;
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
        }

    } while (changed);

    // Save centerline points
    m_centerlines.clear();
    for(int z = 0; z < depth; ++z) {
        for(int y = 0; y < height; ++y) {
            for(int x = 0; x < width; ++x) {
                if(current.at<uchar>(z,y,x) == 1) {
                    m_centerlines.emplace_back(x,y,z);
                }
            }
        }
    }
}

int VesselSegmenter::countNeighbors(const cv::Mat& volume, int x, int y, int z) {
    // Count neighbors in 26-connected neighborhood
    int count = 0;
    for(int dz = -1; dz <= 1; ++dz) {
        for(int dy = -1; dy <= 1; ++dy) {
            for(int dx = -1; dx <= 1; ++dx) {
                if(dx == 0 && dy == 0 && dz == 0) continue;
                if(volume.at<uchar>(z+dz, y+dy, x+dx) == 1) ++count;
            }
        }
    }
    return count;
}

int VesselSegmenter::countTransitions(const cv::Mat& volume, int x, int y, int z) {
    // Count transitions from 0 to 1 in ordered neighbors
    // Using 26 neighbors flattened in order
    std::vector<uchar> neighbors;

    for(int dz = -1; dz <= 1; ++dz)
        for(int dy = -1; dy <= 1; ++dy)
            for(int dx = -1; dx <= 1; ++dx)
                if(!(dx == 0 && dy == 0 && dz == 0))
                    neighbors.push_back(volume.at<uchar>(z+dz, y+dy, x+dx));

    int transitions = 0;
    for(size_t i=0; i < neighbors.size(); ++i) {
        uchar cur = neighbors[i];
        uchar next = neighbors[(i+1) % neighbors.size()];
        if(cur == 0 && next == 1) ++transitions;
    }
    return transitions;
}

bool VesselSegmenter::isEndpoint(const cv::Mat& volume, int x, int y, int z) {
    // Endpoint has exactly one neighbor
    return (countNeighbors(volume, x, y, z) == 1);
}

void VesselSegmenter::detectBranchPoints() {
    // Branch points have more than two connected neighbors on centerline
    m_branchPoints.clear();

    const int* sizes = m_segmentation.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    // Create a temporary 3D map for fast centerline lookup
    cv::Mat centerlineVolume = cv::Mat::zeros(m_segmentation.size, CV_8U);
    for (const auto& pt : m_centerlines)
        centerlineVolume.at<uchar>(pt.z, pt.y, pt.x) = 1;

    for (const auto& pt : m_centerlines) {
        int neighbors = 0;
        for(int dz = -1; dz <= 1; ++dz) {
            for(int dy = -1; dy <= 1; ++dy) {
                for(int dx = -1; dx <= 1; ++dx) {
                    if(dx == 0 && dy == 0 && dz == 0) continue;
                    int nx = pt.x + dx;
                    int ny = pt.y + dy;
                    int nz = pt.z + dz;
                    if(nx >= 0 && ny >=0 && nz >=0 &&
                       nz < depth && ny < height && nx < width) {
                        if(centerlineVolume.at<uchar>(nz, ny, nx) == 1) ++neighbors;
                    }
                }
            }
        }
        if (neighbors > 2) {
            m_branchPoints.push_back(pt);
        }
    }
}

void VesselSegmenter::filterFalsePositives() {
    // Basic filtering by removing small isolated components and noise
    // Remove connected components containing fewer than a size threshold voxels

    const int* sizes = m_segmentation.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    int minComponentSize = 100; // tunable

    // Label connected components in 3D binary volume
    cv::Mat labels(m_segmentation.size, CV_32S, cv::Scalar(0));
    int labelCount = 0;

    for (int z = 0; z < depth; ++z) {
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                if (m_segmentation.at<uchar>(z,y,x) == 255 && labels.at<int>(z,y,x) == 0) {
                    ++labelCount;
                    int compSize = floodFillLabel(cv::Point3i(x,y,z), labelCount, labels);
                    if (compSize < minComponentSize) {
                        removeComponent(labels, labelCount);
                    }
                }
            }
        }
    }
}

int VesselSegmenter::floodFillLabel(const cv::Point3i& seed, int label, cv::Mat& labels) {
    const int* sizes = labels.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    std::queue<cv::Point3i> q;
    q.push(seed);
    labels.at<int>(seed.z, seed.y, seed.x) = label;
    int size = 1;

    int dx[6]{1,-1,0,0,0,0};
    int dy[6]{0,0,1,-1,0,0};
    int dz[6]{0,0,0,0,1,-1};

    while(!q.empty()) {
        auto p = q.front(); q.pop();
        for (int i = 0; i < 6; ++i) {
            int nx = p.x + dx[i];
            int ny = p.y + dy[i];
            int nz = p.z + dz[i];
            if (nx >=0 && ny >=0 && nz >=0 && nx < width && ny < height && nz < depth) {
                if (m_segmentation.at<uchar>(nz, ny, nx) == 255 && labels.at<int>(nz, ny, nx) == 0) {
                    labels.at<int>(nz, ny, nx) = label;
                    q.push(cv::Point3i(nx, ny, nz));
                    ++size;
                }
            }
        }
    }
    return size;
}

void VesselSegmenter::removeComponent(const cv::Mat& labels, int label) {
    const int* sizes = labels.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];
    for (int z = 0; z < depth; ++z) {
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                if (labels.at<int>(z,y,x) == label) {
                    m_segmentation.at<uchar>(z,y,x) = 0;
                }
            }
        }
    }
}

void VesselSegmenter::multiScaleProcessing() {
    // Apply Gaussian smoothing at multiple scales and combine results
    // to enhance vessels of different sizes

    const int* sizes = m_inputVolume.size;
    int depth = sizes[0], height = sizes[1], width = sizes[2];

    std::vector<float> scales{1.0f, 2.0f, 3.0f};
    cv::Mat combinedSeg = cv::Mat::zeros(m_segmentation.size, CV_8U);

    for (float sigma : scales) {
        // Smooth inputVolume
        cv::Mat smoothed = cv::Mat::zeros(m_inputVolume.size, m_inputVolume.type());
        for (int z = 0; z < depth; ++z) {
            cv::Mat slice(height, width, CV_32F, const_cast<float*>(m_inputVolume.ptr<float>(z)));
            cv::Mat outSlice(height, width, CV_32F, smoothed.ptr<float>(z));
            cv::GaussianBlur(slice, outSlice, cv::Size(0,0), sigma);
        }

        // Threshold on smoothed volume
        cv::Mat localSeg = cv::Mat::zeros(m_segmentation.size, CV_8U);
        for (int z = 0; z < depth; ++z) {
            for (int y = 0; y < height; ++y) {
                for (int x = 0; x < width; ++x) {
                    float val = smoothed.at<float>(z,y,x);
                    if(val >= m_lowerThreshold && val <= m_upperThreshold) {
                        localSeg.at<uchar>(z,y,x) = 255;
                    }
                }
            }
        }
        combinedSeg = combinedSeg | localSeg;
    }

    m_segmentation = combinedSeg;
}

float VesselSegmenter::evaluateDiceCoefficient(const cv::Mat& groundTruth) const {
    CV_Assert(m_segmentation.size == groundTruth.size);
    CV_Assert(m_segmentation.type()