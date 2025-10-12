```typescript
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import PatientDataController from '../../../server/controllers/PatientDataController';
import dbService from '../../../server/services/dbService';
import authMiddleware from '../../../server/middleware/authMiddleware';
import auditLogger from '../../../server/utils/auditLogger';

jest.mock('../../../server/services/dbService');
jest.mock('../../../server/middleware/authMiddleware', () => jest.fn((req, res, next) => next()));
jest.mock('../../../server/utils/auditLogger');

const app = express();
app.use(bodyParser.json());
app.use(authMiddleware);
app.use('/patients', PatientDataController);

const mockPatient = {
  id: 'p123',
  name: 'John Doe',
  age: 33,
  condition: 'Healthy',
};

describe('PatientDataController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CREATE /patients', () => {
    it('creates patient successfully', async () => {
      (dbService.createPatient as jest.Mock).mockResolvedValue(mockPatient);

      const res = await request(app)
        .post('/patients')
        .send({ name: 'John Doe', age: 33, condition: 'Healthy' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockPatient);
      expect(dbService.createPatient).toHaveBeenCalledWith({ name: 'John Doe', age: 33, condition: 'Healthy' });
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE_PATIENT',
        resourceId: mockPatient.id,
      }));
    });

    it('returns 400 on invalid data', async () => {
      const res = await request(app)
        .post('/patients')
        .send({ name: '', age: -5 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('errors');
      expect(dbService.createPatient).not.toHaveBeenCalled();
    });

    it('returns 401 if unauthorized', async () => {
      (authMiddleware as jest.Mock).mockImplementationOnce((req, res, next) => res.status(401).json({ message: 'Unauthorized' }));

      const res = await request(app)
        .post('/patients')
        .send({ name: 'John Doe', age: 33, condition: 'Healthy' });

      expect(res.status).toBe(401);
      expect(dbService.createPatient).not.toHaveBeenCalled();
    });

    it('handles service errors gracefully', async () => {
      (dbService.createPatient as jest.Mock).mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/patients')
        .send({ name: 'John Doe', age: 33, condition: 'Healthy' });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('message', 'Internal Server Error');
    });
  });

  describe('READ /patients', () => {
    it('returns paginated list of patients', async () => {
      const patients = [mockPatient, { id: 'p124', name: 'Jane Doe', age: 28, condition: 'Sick' }];
      (dbService.getPatients as jest.Mock).mockResolvedValue({ data: patients, total: 2 });

      const res = await request(app).get('/patients?page=1&limit=2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: patients,
        total: 2,
        page: 1,
        limit: 2,
      });
      expect(dbService.getPatients).toHaveBeenCalledWith({ page: 1, limit: 2 });
    });

    it('returns 401 if unauthorized', async () => {
      (authMiddleware as jest.Mock).mockImplementationOnce((req, res, next) => res.status(401).json({ message: 'Unauthorized' }));

      const res = await request(app).get('/patients');

      expect(res.status).toBe(401);
      expect(dbService.getPatients).not.toHaveBeenCalled();
    });

    it('handles service errors gracefully', async () => {
      (dbService.getPatients as jest.Mock).mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/patients');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('message', 'Internal Server Error');
    });
  });

  describe('READ /patients/:id', () => {
    it('returns patient data for valid id', async () => {
      (dbService.getPatientById as jest.Mock).mockResolvedValue(mockPatient);

      const res = await request(app).get(`/patients/${mockPatient.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockPatient);
      expect(dbService.getPatientById).toHaveBeenCalledWith(mockPatient.id);
    });

    it('returns 404 if patient not found', async () => {
      (dbService.getPatientById as jest.Mock).mockResolvedValue(null);

      const res = await request(app).get('/patients/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('message', 'Patient not found');
    });
  });

  describe('UPDATE /patients/:id', () => {
    it('updates patient successfully', async () => {
      (dbService.updatePatient as jest.Mock).mockResolvedValue({ ...mockPatient, condition: 'Recovering' });

      const res = await request(app)
        .put(`/patients/${mockPatient.id}`)
        .send({ condition: 'Recovering' });

      expect(res.status).toBe(200);
      expect(res.body.condition).toBe('Recovering');
      expect(dbService.updatePatient).toHaveBeenCalledWith(mockPatient.id, { condition: 'Recovering' });
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATE_PATIENT',
        resourceId: mockPatient.id,
      }));
    });

    it('returns 400 on invalid update data', async () => {
      const res = await request(app)
        .put(`/patients/${mockPatient.id}`)
        .send({ age: -10 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('errors');
      expect(dbService.updatePatient).not.toHaveBeenCalled();
    });

    it('returns 404 if patient does not exist', async () => {
      (dbService.updatePatient as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .put('/patients/nonexistent')
        .send({ condition: 'Recovering' });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('message', 'Patient not found');
    });
  });

  describe('DELETE /patients/:id', () => {
    it('deletes patient successfully', async () => {
      (dbService.deletePatient as jest.Mock).mockResolvedValue(true);

      const res = await request(app).delete(`/patients/${mockPatient.id}`);

      expect(res.status).toBe(204);
      expect(dbService.deletePatient).toHaveBeenCalledWith(mockPatient.id);
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'DELETE_PATIENT',
        resourceId: mockPatient.id,
      }));
    });

    it('returns 404 if patient does not exist', async () => {
      (dbService.deletePatient as jest.Mock).mockResolvedValue(false);

      const res = await request(app).delete('/patients/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('message', 'Patient not found');
    });

    it('returns 401 if unauthorized', async () => {
      (authMiddleware as jest.Mock).mockImplementationOnce((req, res, next) => res.status(401).json({ message: 'Unauthorized' }));

      const res = await request(app).delete(`/patients/${mockPatient.id}`);

      expect(res.status).toBe(401);
      expect(dbService.deletePatient).not.toHaveBeenCalled();
    });

    it('handles service errors gracefully', async () => {
      (dbService.deletePatient as jest.Mock).mockRejectedValue(new Error('DB error'));

      const res = await request(app).delete(`/patients/${mockPatient.id}`);

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('message', 'Internal Server Error');
    });
  });
});
```
