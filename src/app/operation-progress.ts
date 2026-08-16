import type { WorkerRequest } from '../workers/protocol';

export function initialOperationTotal(request: WorkerRequest): number {
  switch (request.type) {
    case 'APPLY_TRANSFORMS':
    case 'VALIDATE':
      return request.dataset.rows.length;
    case 'PLAN_WRITE':
      return request.input.incoming.rows.length;
    default:
      return 0;
  }
}
