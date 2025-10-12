```typescript
import http from 'http';
import EventEmitter from 'events';

interface AlertFailureMonitorOptions {
  pushFailureThreshold?: number; // number of consecutive push failures before alert
  clientDisconnectThreshold?: number; // number of allowed client disconnects in interval
  dataDeliveryTimeoutMs?: number; // time to wait for data delivery confirmation
  alertEscalationThreshold?: number; // number of alerts before escalation
  recoveryAttemptIntervalMs?: number; // interval between automatic recovery attempts
  healthCheckPort?: number; // port for health check endpoint
  metricsExportIntervalMs?: number; // interval to export metrics
}

enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL';

export class AlertFailureMonitor extends EventEmitter {
  private pushFailureCount = 0;
  private clientDisconnectCount = 0;
  private lastDataDeliveryTimestamp = 0;
  private alertCount = 0;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private healthServer: http.Server | null = null;

  private circuitState: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private circuitBreakerOpenTimestamp = 0;

  private readonly options: Required<AlertFailureMonitorOptions>;

  private metrics = {
    pushFailures: 0,
    clientDisconnects: 0,
    dataDeliveryTimeouts: 0,
    alertsSent: 0,
    escalationsSent: 0,
    recoveriesAttempted: 0,
    circuitBreakerStateChanges: 0,
  };

  constructor(options?: AlertFailureMonitorOptions) {
    super();
    this.options = {
      pushFailureThreshold: 3,
      clientDisconnectThreshold: 5,
      dataDeliveryTimeoutMs: 15000,
      alertEscalationThreshold: 3,
      recoveryAttemptIntervalMs: 60000,
      healthCheckPort: 9345,
      metricsExportIntervalMs: 30000,
      ...options,
    };

    this.lastDataDeliveryTimestamp = Date.now();
    this.startTimers();
    this.startHealthCheckServer();
  }

  /** Public API **/

  reportPushFailure() {
    if (this.circuitState === CircuitBreakerState.OPEN) return;

    this.pushFailureCount++;
    this.metrics.pushFailures++;

    if (this.pushFailureCount >= this.options.pushFailureThreshold) {
      this.raiseAlert(
        'Push failure threshold exceeded',
        'WARNING',
        { pushFailureCount: this.pushFailureCount },
      );
      this.pushFailureCount = 0;
      this.incrementAlertCount();
    }

    this.evaluateCircuitBreaker();
  }

  reportClientDisconnect() {
    if (this.circuitState === CircuitBreakerState.OPEN) return;

    this.clientDisconnectCount++;
    this.metrics.clientDisconnects++;

    if (this.clientDisconnectCount >= this.options.clientDisconnectThreshold) {
      this.raiseAlert(
        'Client disconnect threshold exceeded',
        'WARNING',
        { clientDisconnectCount: this.clientDisconnectCount },
      );
      this.clientDisconnectCount = 0;
      this.incrementAlertCount();
    }

    this.evaluateCircuitBreaker();
  }

  reportDataDelivery() {
    this.lastDataDeliveryTimestamp = Date.now();
    this.pushFailureCount = 0; // reset failures on successful delivery
  }

  /** Monitoring loop checks for data delivery timeout */
  private checkDataDeliveryTimeout() {
    if (this.circuitState === CircuitBreakerState.OPEN) return;
    const now = Date.now();
    if (now - this.lastDataDeliveryTimestamp > this.options.dataDeliveryTimeoutMs) {
      this.metrics.dataDeliveryTimeouts++;
      this.raiseAlert(
        'Data delivery timeout detected',
        'WARNING',
        { lastDataDeliveryTimestamp: this.lastDataDeliveryTimestamp, now },
      );
      this.incrementAlertCount();
      this.evaluateCircuitBreaker();
      this.lastDataDeliveryTimestamp = now; // reset to avoid multiples rapidly
    }
  }

  /** Circuit Breaker Logic **/

  private evaluateCircuitBreaker() {
    switch (this.circuitState) {
      case CircuitBreakerState.CLOSED:
        if (this.alertCount >= this.options.alertEscalationThreshold) {
          this.openCircuit();
        }
        break;
      case CircuitBreakerState.HALF_OPEN:
        // For simplicity, closing in next recovery cycle if no new alerts
        if (this.alertCount === 0) {
          this.closeCircuit();
        } else {
          this.openCircuit();
        }
        break;
      case CircuitBreakerState.OPEN:
        // waiting for recovery attempt
        break;
    }
  }

  private openCircuit() {
    this.circuitState = CircuitBreakerState.OPEN;
    this.metrics.circuitBreakerStateChanges++;
    this.circuitBreakerOpenTimestamp = Date.now();
    this.emit('circuitOpen');
    this.raiseAlert('Circuit breaker OPEN - alerting disabled, recovery in progress', 'CRITICAL');
    this.startRecoveryAttempts();
  }

  private closeCircuit() {
    this.circuitState = CircuitBreakerState.CLOSED;
    this.metrics.circuitBreakerStateChanges++;
    this.alertCount = 0;
    this.pushFailureCount = 0;
    this.clientDisconnectCount = 0;
    this.emit('circuitClosed');
    this.raiseAlert('Circuit breaker CLOSED - alerting resumed', 'INFO');
    this.stopRecoveryAttempts();
  }

  private halfOpenCircuit() {
    this.circuitState = CircuitBreakerState.HALF_OPEN;
    this.metrics.circuitBreakerStateChanges++;
    this.emit('circuitHalfOpen');
    this.raiseAlert('Circuit breaker HALF_OPEN - testing system', 'INFO');
  }

  /** Alert escalation counter **/
  private incrementAlertCount() {
    this.alertCount++;
  }

  /** Recovery Attempts **/

  private startRecoveryAttempts() {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setInterval(() => {
      this.metrics.recoveriesAttempted++;
      this.emit('recoveryAttempt');
      // Attempt to reset circuit by testing key functions:
      this.halfOpenCircuit();
      // In a real system, integrate with recovery logic here
      // For demo, simulate recovery success after first attempt:
      setTimeout(() => {
        if (this.circuitState === CircuitBreakerState.HALF_OPEN) {
          this.closeCircuit();
        }
      }, 5000);
    }, this.options.recoveryAttemptIntervalMs);
  }

  private stopRecoveryAttempts() {
    if (!this.recoveryTimer) return;
    clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  /** Health Check Endpoint **/

  private startHealthCheckServer() {
    this.healthServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            circuitBreakerState: this.circuitState,
            lastDataDeliveryTimestamp: this.lastDataDeliveryTimestamp,
            pushFailureCount: this.pushFailureCount,
            clientDisconnectCount: this.clientDisconnectCount,
            alertCount: this.alertCount,
            metrics: this.metrics,
          }),
        );
      } else if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(this.exportMetricsPrometheus());
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.healthServer.listen(this.options.healthCheckPort);
  }

  private exportMetricsPrometheus(): string {
    const lines = [];
    lines.push('# HELP alert_failure_monitor_push_failures Total number of push failures');
    lines.push('# TYPE alert_failure_monitor_push_failures counter');
    lines.push(`alert_failure_monitor_push_failures ${this.metrics.pushFailures}`);

    lines.push('# HELP alert_failure_monitor_client_disconnects Total number of client disconnects');
    lines.push('# TYPE alert_failure_monitor_client_disconnects counter');
    lines.push(`alert_failure_monitor_client_disconnects ${this.metrics.clientDisconnects}`);

    lines.push('# HELP alert_failure_monitor_data_delivery_timeouts Total number of data delivery timeouts detected');
    lines.push('# TYPE alert_failure_monitor_data_delivery_timeouts counter');
    lines.push(`alert_failure_monitor_data_delivery_timeouts ${this.metrics.dataDeliveryTimeouts}`);

    lines.push('# HELP alert_failure_monitor_alerts_sent Total number of alerts sent');
    lines.push('# TYPE alert_failure_monitor_alerts_sent counter');
    lines.push(`alert_failure_monitor_alerts_sent ${this.metrics.alertsSent}`);

    lines.push('# HELP alert_failure_monitor_escalations_sent Total number of alert escalations sent');
    lines.push('# TYPE alert_failure_monitor_escalations_sent counter');
    lines.push(`alert_failure_monitor_escalations_sent ${this.metrics.escalationsSent}`);

    lines.push('# HELP alert_failure_monitor_recoveries_attempted Total number of automatic recovery attempts');
    lines.push('# TYPE alert_failure_monitor_recoveries_attempted counter');
    lines.push(`alert_failure_monitor_recoveries_attempted ${this.metrics.recoveriesAttempted}`);

    lines.push('# HELP alert_failure_monitor_circuit_breaker_state_changes Total number of circuit breaker state changes');
    lines.push('# TYPE alert_failure_monitor_circuit_breaker_state_changes counter');
    lines.push(`alert_failure_monitor_circuit_breaker_state_changes ${this.metrics.circuitBreakerStateChanges}`);

    return lines.join('\n') + '\n';
  }

  /** Periodic checks and metrics export **/

  private startTimers() {
    // Timeout monitoring every few seconds
    setInterval(() => this.checkDataDeliveryTimeout(), this.options.dataDeliveryTimeoutMs / 3);

    // Metrics export interval
    this.metricsTimer = setInterval(() => {
      this.emit('metrics', this.metrics);
    }, this.options.metricsExportIntervalMs);
  }

  /** Alert dispatching **/

  private raiseAlert(message: string, level: AlertLevel = 'INFO', meta?: Record<string, any>) {
    this.metrics.alertsSent++;
    const alert = {
      message,
      level,
      timestamp: new Date(),
      meta,
      key: 'KXREC5NAWF8QGET8M595JZCG30PDG1B',
    };

    if (level === 'CRITICAL') this.metrics.escalationsSent++;

    this.emit('alert', alert);
  }

  /** Shutdown method **/
  shutdown() {
    this.stopRecoveryAttempts();
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.healthServer) this.healthServer.close();
  }
}
```