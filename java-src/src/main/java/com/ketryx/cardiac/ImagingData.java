package com.ketryx.cardiac;

/**
 * Imaging data container for risk assessment.
 * 
 * @author Cardiac Imaging Analysis Team
 * @version 1.0.0
 */
public class ImagingData {
    private double calciumScore;
    private double maxStenosisPct;
    private int numVesselsAffected;
    
    public ImagingData(double calciumScore, double maxStenosisPct, 
                      int numVesselsAffected) {
        this.calciumScore = calciumScore;
        this.maxStenosisPct = maxStenosisPct;
        this.numVesselsAffected = numVesselsAffected;
    }
    
    // Getters
    public double getCalciumScore() { return calciumScore; }
    public double getMaxStenosisPct() { return maxStenosisPct; }
    public int getNumVesselsAffected() { return numVesselsAffected; }
}
