package com.ketryx.cardiac;

/**
 * Clinical data container for risk assessment.
 * 
 * @author Cardiac Imaging Analysis Team
 * @version 1.0.0
 */
public class ClinicalData {
    private int age;
    private String sex;
    private double totalCholesterol;
    private double hdlCholesterol;
    private double systolicBp;
    private boolean smoker;
    private boolean diabetes;
    private boolean familyHistory;
    
    public ClinicalData(int age, String sex, double totalCholesterol,
                       double hdlCholesterol, double systolicBp,
                       boolean smoker, boolean diabetes, boolean familyHistory) {
        this.age = age;
        this.sex = sex;
        this.totalCholesterol = totalCholesterol;
        this.hdlCholesterol = hdlCholesterol;
        this.systolicBp = systolicBp;
        this.smoker = smoker;
        this.diabetes = diabetes;
        this.familyHistory = familyHistory;
    }
    
    // Getters
    public int getAge() { return age; }
    public String getSex() { return sex; }
    public double getTotalCholesterol() { return totalCholesterol; }
    public double getHdlCholesterol() { return hdlCholesterol; }
    public double getSystolicBp() { return systolicBp; }
    public boolean isSmoker() { return smoker; }
    public boolean hasDiabetes() { return diabetes; }
    public boolean hasFamilyHistory() { return familyHistory; }
}
