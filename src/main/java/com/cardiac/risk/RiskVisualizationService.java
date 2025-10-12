```java
package com.cardiac.risk;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.jfree.chart.ChartFactory;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.plot.PlotOrientation;
import org.jfree.chart.ChartUtils;
import org.jfree.data.category.DefaultCategoryDataset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@Service
public class RiskVisualizationService {

    private static final Logger logger = LoggerFactory.getLogger(RiskVisualizationService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Format a raw risk score value into a human-friendly string with percentage and risk category.
     *
     * @param riskScore risk score as a decimal (e.g. 0.25 for 25%)
     * @return formatted string for UI display
     */
    public String formatRiskScoreForDisplay(double riskScore) {
        try {
            String category = categorizeRisk(riskScore);
            String formatted = String.format("%.1f%% (%s Risk)", riskScore * 100, category);
            return formatted;
        } catch (Exception e) {
            logger.error("Error formatting risk score: {}", riskScore, e);
            return "N/A";
        }
    }

    private String categorizeRisk(double riskScore) {
        if (riskScore < 0) return "Invalid";
        if (riskScore < 0.1) return "Low";
        if (riskScore < 0.2) return "Moderate";
        if (riskScore < 0.4) return "High";
        return "Very High";
    }

    /**
     * Generate a bar chart image representing multiple risk scores for different patients or categories.
     *
     * @param title      chart title
     * @param labels     labels for each risk score entry
     * @param riskScores corresponding risk scores
     * @return byte array of PNG image data, or null on failure
     */
    public byte[] generateRiskScoreChart(String title, List<String> labels, List<Double> riskScores) {
        if (labels == null || riskScores == null || labels.size() != riskScores.size()) {
            logger.error("Labels and riskScores must be non-null and have the same size");
            return null;
        }
        try {
            DefaultCategoryDataset dataset = new DefaultCategoryDataset();
            for (int i = 0; i < labels.size(); i++) {
                dataset.addValue(riskScores.get(i) * 100, "Risk Score (%)", labels.get(i));
            }
            JFreeChart barChart = ChartFactory.createBarChart(
                    title, "Category", "Risk Score (%)", dataset,
                    PlotOrientation.VERTICAL, false, true, false);

            BufferedImage chartImage = barChart.createBufferedImage(800, 600);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ChartUtils.writeBufferedImageAsPNG(baos, chartImage);
            return baos.toByteArray();
        } catch (IOException e) {
            logger.error("Error generating risk score chart", e);
            return null;
        }
    }

    /**
     * Create a textual report comparing multiple risk scores.
     *
     * @param entries map of label to risk score (0-1 scale)
     * @return formatted risk comparison report string
     */
    public String createRiskComparisonReport(Map<String, Double> entries) {
        if (entries == null || entries.isEmpty()) {
            logger.warn("No entries provided for risk comparison report");
            return "No data available.";
        }

        StringBuilder report = new StringBuilder("Risk Comparison Report:\n");
        entries.forEach((label, score) -> {
            String line = String.format(" - %s: %s\n", label, formatRiskScoreForDisplay(score));
            report.append(line);
        });

        // Identify highest and lowest
        String highestLabel = null;
        double highestScore = Double.NEGATIVE_INFINITY;
        String lowestLabel = null;
        double lowestScore = Double.POSITIVE_INFINITY;

        for (Map.Entry<String, Double> e : entries.entrySet()) {
            if (e.getValue() > highestScore) {
                highestScore = e.getValue();
                highestLabel = e.getKey();
            }
            if (e.getValue() < lowestScore) {
                lowestScore = e.getValue();
                lowestLabel = e.getKey();
            }
        }

        report.append(String.format("\nHighest risk: %s (%s)\n", 
                highestLabel, formatRiskScoreForDisplay(highestScore)));
        report.append(String.format("Lowest risk: %s (%s)\n", 
                lowestLabel, formatRiskScoreForDisplay(lowestScore)));

        return report.toString();
    }

    /**
     * Export risk data into JSON format.
     *
     * @param riskData map or POJO representing risk data
     * @return JSON string or null if error occurs
     */
    public String exportRiskDataAsJson(Object riskData) {
        try {
            return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(riskData);
        } catch (JsonProcessingException e) {
            logger.error("Error exporting risk data as JSON", e);
            return null;
        }
    }

    /**
     * Export risk data into CSV format.
     *
     * @param headers   CSV column headers
     * @param rows      list of rows with each row as a list of string values
     * @return CSV formatted string or null on failure
     */
    public String exportRiskDataAsCsv(List<String> headers, List<List<String>> rows) {
        if (headers == null || rows == null) {
            logger.error("Headers or rows cannot be null for CSV export");
            return null;
        }

        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            CSVPrinter printer = new CSVPrinter(new java.io.OutputStreamWriter(baos, StandardCharsets.UTF_8),
                    CSVFormat.DEFAULT.withHeader(headers.toArray(new String[0])));

            for (List<String> row : rows) {
                printer.printRecord(row);
            }
            printer.flush();
            return baos.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            logger.error("Error exporting risk data as CSV", e);
            return null;
        }
    }

    /**
     * Generate a brief clinical decision support summary based on a given risk score.
     *
     * @param riskScore risk score as decimal
     * @return clinical decision support summary string
     */
    public String generateClinicalDecisionSupportSummary(double riskScore) {
        try {
            String category = categorizeRisk(riskScore);
            StringBuilder summary = new StringBuilder();
            summary.append("Clinical Decision Support Summary:\n");
            summary.append(String.format("Risk Score: %s\n", formatRiskScoreForDisplay(riskScore)));
            switch (category) {
                case "Low":
                    summary.append("Recommendation: Routine monitoring recommended.\n");
                    summary.append("Consider lifestyle modifications to maintain low risk.\n");
                    break;
                case "Moderate":
                    summary.append("Recommendation: Evaluate patient for potential interventions.\n");
                    summary.append("Consider detailed risk factor assessment.\n");
                    break;
                case "High":
                    summary.append("Recommendation: Initiate risk-reducing therapies promptly.\n");
                    summary.append("Close monitoring and follow-up required.\n");
                    break;
                case "Very High":
                    summary.append("Recommendation: Urgent clinical review and aggressive management.\n");
                    summary.append("Referral to specialist may be warranted.\n");
                    break;
                default:
                    summary.append("Recommendation: Risk score invalid or unavailable.\n");
                    break;
            }
            return summary.toString();
        } catch (Exception e) {
            logger.error("Error generating clinical decision support summary for riskScore: {}", riskScore, e);
            return "Unable to generate clinical decision support summary.";
        }
    }
}
```