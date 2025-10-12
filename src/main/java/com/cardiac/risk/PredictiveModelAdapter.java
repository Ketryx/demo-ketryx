```java
package com.cardiac.risk;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Collections;
import java.util.Map;
import java.util.Objects;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Adapter class for integrating with machine learning predictive models.
 * Responsible for loading model artifacts, preprocessing inputs, invoking predictions,
 * postprocessing outputs, managing model metadata and versioning, and error handling.
 */
public class PredictiveModelAdapter {

    private static final Logger LOGGER = Logger.getLogger(PredictiveModelAdapter.class.getName());

    private final ModelLoader modelLoader;
    private final ModelInvoker modelInvoker;
    private final Preprocessor preprocessor;
    private final Postprocessor postprocessor;
    private volatile ModelArtifact currentModelArtifact;

    public PredictiveModelAdapter(ModelLoader loader,
                                  ModelInvoker invoker,
                                  Preprocessor preprocessor,
                                  Postprocessor postprocessor) {
        this.modelLoader = Objects.requireNonNull(loader, "ModelLoader cannot be null");
        this.modelInvoker = Objects.requireNonNull(invoker, "ModelInvoker cannot be null");
        this.preprocessor = Objects.requireNonNull(preprocessor, "Preprocessor cannot be null");
        this.postprocessor = Objects.requireNonNull(postprocessor, "Postprocessor cannot be null");
    }

    /**
     * Loads a trained model artifact from the given path.
     * Updates the current model artifact with new metadata.
     *
     * @param modelPath filesystem path to the model artifact
     * @throws PredictiveModelException if loading fails
     */
    public synchronized void loadModel(Path modelPath) throws PredictiveModelException {
        try {
            byte[] artifactData = Files.readAllBytes(modelPath);
            ModelMetadata metadata = extractMetadata(modelPath);
            ModelArtifact modelArtifact = new ModelArtifact(artifactData, metadata);
            modelLoader.load(modelArtifact);
            currentModelArtifact = modelArtifact;
            LOGGER.info(() -> String.format("Model loaded successfully: %s v%s at %s",
                    metadata.getModelName(), metadata.getVersion(), metadata.getLoadedAt()));
        } catch (IOException e) {
            throw new PredictiveModelException("Failed to load model from path: " + modelPath, e);
        }
    }

    /**
     * Invokes the predictive model on given raw inputs.
     * Handles preprocessing, model invocation, and postprocessing.
     *
     * @param patientData  raw patient data
     * @param blockageData raw blockage data
     * @return risk score as a double between 0 and 1
     * @throws PredictiveModelException if prediction fails or model is not loaded
     */
    public double predictRiskScore(Map<String, Object> patientData,
                                   Map<String, Object> blockageData) throws PredictiveModelException {
        checkModelLoaded();
        try {
            double[] features = preprocessor.preprocess(patientData, blockageData);
            double[] outputs = modelInvoker.invoke(features, currentModelArtifact);
            return postprocessor.postprocess(outputs);
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Prediction failed", e);
            throw new PredictiveModelException("Prediction failed", e);
        }
    }

    /**
     * Retrieves the current loaded model's metadata.
     *
     * @return current model metadata or null if no model is loaded
     */
    public ModelMetadata getCurrentModelMetadata() {
        return currentModelArtifact != null ? currentModelArtifact.getMetadata() : null;
    }

    private void checkModelLoaded() throws PredictiveModelException {
        if (currentModelArtifact == null) {
            throw new PredictiveModelException("No model loaded. Load a trained model before prediction.");
        }
    }

    private ModelMetadata extractMetadata(Path modelPath) {
        // Implementation can be extended to extract detailed metadata from the artifact or file name
        String modelName = "CardiacRiskModel";
        String version = "unknown";
        Instant loadedAt = Instant.now();
        try {
            String fileName = modelPath.getFileName().toString();
            if (fileName.contains("_v")) {
                int idx = fileName.indexOf("_v") + 2;
                int end = fileName.indexOf('.', idx);
                if (end == -1) end = fileName.length();
                version = fileName.substring(idx, end);
            }
        } catch (Exception e) {
            LOGGER.warning("Failed to parse model version from file name, defaulting to 'unknown'");
        }
        return new ModelMetadata(modelName, version, loadedAt);
    }

    public interface ModelLoader {
        /**
         * Loads the model artifact into the runtime environment.
         * @param artifact the model artifact to load
         * @throws PredictiveModelException if loading fails
         */
        void load(ModelArtifact artifact) throws PredictiveModelException;
    }

    public interface ModelInvoker {
        /**
         * Invokes the model on the given input features.
         *
         * @param features array of input features preprocessed for the model input
         * @param artifact the model artifact containing the loaded model
         * @return raw model output values
         * @throws PredictiveModelException if invocation fails
         */
        double[] invoke(double[] features, ModelArtifact artifact) throws PredictiveModelException;
    }

    public interface Preprocessor {
        /**
         * Converts raw patient and blockage data into array of input features for the model.
         *
         * @param patientData  key-value structured patient data
         * @param blockageData key-value structured blockage data
         * @return array of doubles representing model input features
         * @throws PredictiveModelException if preprocessing fails
         */
        double[] preprocess(Map<String, Object> patientData, Map<String, Object> blockageData) throws PredictiveModelException;
    }

    public interface Postprocessor {
        /**
         * Converts raw model output to a risk score.
         *
         * @param modelOutput raw outputs from the predictive model invocation
         * @return risk score as double in [0,1]
         * @throws PredictiveModelException if postprocessing fails
         */
        double postprocess(double[] modelOutput) throws PredictiveModelException;
    }

    public static class ModelArtifact {
        private final byte[] artifactData;
        private final ModelMetadata metadata;

        public ModelArtifact(byte[] artifactData, ModelMetadata metadata) {
            this.artifactData = artifactData;
            this.metadata = metadata;
        }

        public byte[] getArtifactData() {
            return artifactData;
        }

        public ModelMetadata getMetadata() {
            return metadata;
        }
    }

    public static class ModelMetadata {
        private final String modelName;
        private final String version;
        private final Instant loadedAt;

        public ModelMetadata(String modelName, String version, Instant loadedAt) {
            this.modelName = modelName;
            this.version = version;
            this.loadedAt = loadedAt;
        }

        public String getModelName() {
            return modelName;
        }

        public String getVersion() {
            return version;
        }

        public Instant getLoadedAt() {
            return loadedAt;
        }
    }

    public static class PredictiveModelException extends Exception {
        public PredictiveModelException(String message) {
            super(message);
        }

        public PredictiveModelException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
```