```cpp
#include <gtest/gtest.h>
#include <chrono>
#include <vector>
#include <cmath>
#include <random>

// Assume these headers exist and implement the relevant functionality.
#include "modeling/VesselSegmenter.h"
#include "data/CTImage.h"
#include "metrics/SegmentationMetrics.h"

// Utility to generate synthetic CT image with vessel-like tubular structures.
CTImage GenerateSyntheticVesselCT(int size, const std::vector<std::tuple<int,int,int,int,int,int>>& vessels) {
    // vessels: vector of (x0,y0,z0,x1,y1,z1) line segments representing vessels
    CTImage img(size, size, size);
    img.Fill(0.0f);

    for (const auto& v : vessels) {
        int x0,y0,z0,x1,y1,z1;
        std::tie(x0,y0,z0,x1,y1,z1) = v;
        // Bresenham-like 3D line drawing
        int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        int dy = std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        int dz = std::abs(z1 - z0), sz = z0 < z1 ? 1 : -1;
        int err_1, err_2;

        int x = x0, y = y0, z = z0;
        int dominant_axis = std::max({dx, dy, dz});

        for (int i = 0; i <= dominant_axis; ++i) {
            if (x>=0 && x<size && y>=0 && y<size && z>=0 && z<size)
                img.SetVoxel(x,y,z, 1000.0f); // high intensity for vessels

            if (dominant_axis == dx) {
                x += sx;
                if (i*dy >= dx) y += sy;
                if (i*dz >= dx) z += sz;
            } else if (dominant_axis == dy) {
                y += sy;
                if (i*dx >= dy) x += sx;
                if (i*dz >= dy) z += sz;
            } else {
                z += sz;
                if (i*dx >= dz) x += sx;
                if (i*dy >= dz) y += sy;
            }
        }
    }
    return img;
}

// Add Gaussian noise to CT image
void AddGaussianNoise(CTImage& img, float mean, float stddev) {
    std::default_random_engine gen(42);
    std::normal_distribution<float> dist(mean, stddev);
    int sx = img.SizeX(), sy = img.SizeY(), sz = img.SizeZ();
    for (int z=0; z<sz; ++z) {
        for (int y=0; y<sy; ++y) {
            for (int x=0; x<sx; ++x) {
                float val = img.GetVoxel(x,y,z);
                val += dist(gen);
                img.SetVoxel(x,y,z, val);
            }
        }
    }
}

class VesselSegmenterTest : public ::testing::Test {
protected:
    void SetUp() override {
        size_ = 64;
        // Define simple synthetic vessels: one main vessel and two bifurcations
        vessels_ = {
            {16,32,32, 48,32,32}, // main vessel along x-axis
            {48,32,32, 56,40,32}, // branch 1
            {48,32,32, 56,24,32}  // branch 2
        };
        syntheticCT_ = GenerateSyntheticVesselCT(size_, vessels_);
    }

    int size_;
    std::vector<std::tuple<int,int,int,int,int,int>> vessels_;
    CTImage syntheticCT_;
    VesselSegmenter segmenter_;
};

TEST_F(VesselSegmenterTest, SyntheticSegmentationAccuracy) {
    auto segmentation = segmenter_.Segment(syntheticCT_);
    // Generate ground truth mask:
    CTImage gtMask(size_, size_, size_);
    gtMask.Fill(0);
    for (const auto& v : vessels_) {
        int x0,y0,z0,x1,y1,z1;
        std::tie(x0,y0,z0,x1,y1,z1) = v;
        // Draw lines with radius ~1 voxel
        for (int t=0; t<=100; ++t) {
            float alpha = t/100.f;
            int x = (int)(x0 + alpha*(x1-x0));
            int y = (int)(y0 + alpha*(y1-y0));
            int z = (int)(z0 + alpha*(z1-z0));
            for (int dz=-1; dz<=1; ++dz) {
                for (int dy=-1; dy<=1; ++dy) {
                    for (int dx=-1; dx<=1; ++dx) {
                        int nx = x+dx, ny = y+dy, nz = z+dz;
                        if (nx>=0 && nx<size_ && ny>=0 && ny<size_ && nz>=0 && nz<size_)
                            gtMask.SetVoxel(nx,ny,nz, 1);
                    }
                }
            }
        }
    }
    SegmentationMetrics metrics(gtMask, segmentation);
    EXPECT_GT(metrics.Dice(), 0.85);
    EXPECT_GT(metrics.Sensitivity(), 0.80);
    EXPECT_LT(metrics.FalsePositiveRate(), 0.05);
}

TEST_F(VesselSegmenterTest, DetectSmallVesselsAndBifurcations) {
    // Synthetic vessels with smaller branches
    vessels_.push_back({56,40,32, 60,42,32}); // smaller branch
    vessels_.push_back({56,24,32, 60,22,32}); // smaller branch
    syntheticCT_ = GenerateSyntheticVesselCT(size_, vessels_);
    auto segmentation = segmenter_.Segment(syntheticCT_);
    // Count detected bifurcation points from segmentation
    int bifurcationPoints = segmenter_.CountBifurcations(segmentation);
    EXPECT_GE(bifurcationPoints, 3); // 1 main + 2 bifurcations at least
    // Small vessels presence (expect detected)
    int smallVessels = segmenter_.CountSmallVessels(segmentation, 3); // vessels < 3 voxels diameter
    EXPECT_GE(smallVessels, 2);
}

TEST_F(VesselSegmenterTest, RobustnessToImageNoise) {
    CTImage noisyCT = syntheticCT_;
    AddGaussianNoise(noisyCT, 0.f, 50.f);
    auto segmentation = segmenter_.Segment(noisyCT);
    SegmentationMetrics metrics(syntheticCT_, segmentation);
    // Expect metrics degrade but stay reasonable
    EXPECT_GT(metrics.Dice(), 0.70);
    EXPECT_GT(metrics.Sensitivity(), 0.65);
}

TEST_F(VesselSegmenterTest, SensitivitySpecificityMetrics) {
    auto segmentation = segmenter_.Segment(syntheticCT_);
    CTImage gtMask(size_, size_, size_);
    gtMask.Fill(0);
    // Same ground truth as earlier
    for (const auto& v : vessels_) {
        int x0,y0,z0,x1,y1,z1;
        std::tie(x0,y0,z0,x1,y1,z1) = v;
        for (int t=0; t<=100; ++t) {
            float alpha = t/100.f;
            int x = (int)(x0 + alpha*(x1-x0));
            int y = (int)(y0 + alpha*(y1-y0));
            int z = (int)(z0 + alpha*(z1-z0));
            for (int dz=-1; dz<=1; ++dz) {
                for (int dy=-1; dy<=1; ++dy) {
                    for (int dx=-1; dx<=1; ++dx) {
                        int nx = x+dx, ny = y+dy, nz = z+dz;
                        if (nx>=0 && nx<size_ && ny>=0 && ny<size_ && nz>=0 && nz<size_)
                            gtMask.SetVoxel(nx,ny,nz, 1);
                    }
                }
            }
        }
    }
    SegmentationMetrics metrics(gtMask, segmentation);
    EXPECT_NEAR(metrics.Sensitivity(), metrics.CalculateSensitivity(), 1e-5);
    EXPECT_NEAR(metrics.Specificity(), metrics.CalculateSpecificity(), 1e-5);
}

TEST_F(VesselSegmenterTest, ProcessingSpeedBenchmark) {
    const int runs = 10;
    std::vector<double> times;
    for (int i=0; i<runs; ++i){
        auto start = std::chrono::high_resolution_clock::now();
        segmenter_.Segment(syntheticCT_);
        auto end = std::chrono::high_resolution_clock::now();
        std::chrono::duration<double> diff = end - start;
        times.push_back(diff.count());
    }
    double avgTime = std::accumulate(times.begin(), times.end(), 0.0) / times.size();
    // We expect segmentation runs under 1 second on average
    EXPECT_LT(avgTime, 1.0);
}

TEST_F(VesselSegmenterTest, MultiScaleSegmentationTest) {
    segmenter_.EnableMultiScale(true);
    auto segmentationMulti = segmenter_.Segment(syntheticCT_);
    segmenter_.EnableMultiScale(false);
    auto segmentationSingle = segmenter_.Segment(syntheticCT_);
    SegmentationMetrics metricsMulti(syntheticCT_, segmentationMulti);
    SegmentationMetrics metricsSingle(syntheticCT_, segmentationSingle);
    // Multi-scale should improve Dice score
    EXPECT_GT(metricsMulti.Dice(), metricsSingle.Dice());
}

TEST_F(VesselSegmenterTest, FalsePositiveRateTest) {
    CTImage emptyCT(size_, size_, size_);
    emptyCT.Fill(0.0f);
    auto segmentation = segmenter_.Segment(emptyCT);
    // Expect minimal false positives
    float fpRate = segmenter_.FalsePositiveRate(segmentation, emptyCT);
    EXPECT_LT(fpRate, 0.01);
}

TEST_F(VesselSegmenterTest, EdgeCaseHandling_EmptyImage) {
    CTImage emptyCT(size_, size_, size_);
    emptyCT.Fill(0.0f);
    auto segmentation = segmenter_.Segment(emptyCT);
    // Segmentation should be empty
    int count = segmentation.CountVoxels(1);
    EXPECT_EQ(count, 0);
}

TEST_F(VesselSegmenterTest, EdgeCaseHandling_MaxIntensityImage) {
    CTImage brightCT(size_, size_, size_);
    brightCT.Fill(10000.0f);
    auto segmentation = segmenter_.Segment(brightCT);
    // Should not crash; segmentation possibly all vessels
    int count = segmentation.CountVoxels(1);
    EXPECT_GT(count, 0);
}

TEST_F(VesselSegmenterTest, RealCTDataSegmentation) {
    // This test assumes access to a real CT data fixture
    CTImage realCT;
    ASSERT_TRUE(realCT.LoadFromFile("tests/data/real_ct_image.nii"));
    auto segmentation = segmenter_.Segment(realCT);
    // We cannot know ground truth here, but expect some vessels detected
    int vesselCount = segmentation.CountVoxels(1);
    EXPECT_GT(vesselCount, 500);
}

```