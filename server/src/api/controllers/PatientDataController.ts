```typescript
import { Request, Response } from 'express';
import {
  createPatientDtoSchema,
  updatePatientDtoSchema,
  PatientFilterParams,
  PatientDto,
} from '../dtos/PatientDtos';
import { PatientService } from '../services/PatientService';
import { AuditLogger } from '../services/AuditLogger';
import { ValidationError } from 'joi';
import { UnauthorizedError, NotFoundError } from '../errors/HttpErrors';

export class PatientDataController {
  private patientService: PatientService;
  private auditLogger: AuditLogger;

  constructor(patientService: PatientService, auditLogger: AuditLogger) {
    this.patientService = patientService;
    this.auditLogger = auditLogger;
  }

  private async authorize(req: Request): Promise<void> {
    if (!req.user || !req.user.permissions?.includes('patient:data:access')) {
      throw new UnauthorizedError('Insufficient permissions');
    }
  }

  public createPatient = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authorize(req);

      const { error, value } = createPatientDtoSchema.validate(req.body);
      if (error) {
        res.status(400).json({ message: 'Validation error', details: error.details });
        return;
      }
      const newPatient: PatientDto = value;

      const createdPatient = await this.patientService.createPatient(newPatient);

      await this.auditLogger.log(req.user.id, 'CREATE_PATIENT', {
        patientId: createdPatient.id,
        data: newPatient,
      });

      res.status(201).json(createdPatient);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  public getPatientById = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authorize(req);

      const patientId = req.params.id;
      const patient = await this.patientService.getPatientById(patientId);
      if (!patient) {
        res.status(404).json({ message: `Patient with id ${patientId} not found` });
        return;
      }

      await this.auditLogger.log(req.user.id, 'READ_PATIENT', { patientId });

      res.status(200).json(patient);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  public updatePatient = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authorize(req);

      const patientId = req.params.id;
      const { error, value } = updatePatientDtoSchema.validate(req.body);
      if (error) {
        res.status(400).json({ message: 'Validation error', details: error.details });
        return;
      }
      const updateData: Partial<PatientDto> = value;

      const updatedPatient = await this.patientService.updatePatient(patientId, updateData);
      if (!updatedPatient) {
        res.status(404).json({ message: `Patient with id ${patientId} not found` });
        return;
      }

      await this.auditLogger.log(req.user.id, 'UPDATE_PATIENT', {
        patientId,
        updatedData: updateData,
      });

      res.status(200).json(updatedPatient);
    } catch (err) {
      this.handleError(res, err);
    }
  };

  public deletePatient = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authorize(req);

      const patientId = req.params.id;
      const deleted = await this.patientService.deletePatient(patientId);
      if (!deleted) {
        res.status(404).json({ message: `Patient with id ${patientId} not found` });
        return;
      }

      await this.auditLogger.log(req.user.id, 'DELETE_PATIENT', { patientId });

      res.status(204).send();
    } catch (err) {
      this.handleError(res, err);
    }
  };

  public listPatients = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.authorize(req);

      const query = req.query as unknown as PatientFilterParams;

      // Pagination defaults
      const page = Number(query.page) > 0 ? Number(query.page) : 1;
      const limit = Number(query.limit) > 0 && Number(query.limit) <= 100 ? Number(query.limit) : 20;

      const filters = this.buildFiltersFromQuery(query);

      const { data, total } = await this.patientService.listPatients({
        filters,
        page,
        limit,
      });

      await this.auditLogger.log(req.user.id, 'LIST_PATIENTS', { filters, page, limit });

      res.status(200).json({
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      this.handleError(res, err);
    }
  };

  private buildFiltersFromQuery(query: PatientFilterParams): Record<string, any> {
    const filters: Record<string, any> = {};

    if (query.name) {
      filters.name = { $regex: new RegExp(query.name, 'i') };
    }
    if (query.minAge) {
      filters.age = filters.age || {};
      filters.age.$gte = Number(query.minAge);
    }
    if (query.maxAge) {
      filters.age = filters.age || {};
      filters.age.$lte = Number(query.maxAge);
    }
    if (query.gender) {
      filters.gender = query.gender;
    }
    if (query.condition) {
      filters.conditions = { $in: [query.condition] };
    }
    if (query.search) {
      // Full text or multi-field search example
      filters.$text = { $search: query.search };
    }

    return filters;
  }

  private handleError(res: Response, err: unknown): void {
    if (err instanceof ValidationError) {
      res.status(400).json({ message: 'Validation error', details: err.details });
    } else if (err instanceof UnauthorizedError) {
      res.status(403).json({ message: err.message });
    } else if (err instanceof NotFoundError) {
      res.status(404).json({ message: err.message });
    } else {
      // Log unexpected error here if logger available
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
}
```