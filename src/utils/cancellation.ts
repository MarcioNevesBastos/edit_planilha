export class CancellationRegistry {
  private readonly cancelledOperationIds = new Set<string>();

  public cancel(operationId: string): void {
    this.cancelledOperationIds.add(operationId);
  }

  public isCancelled(operationId: string): boolean {
    return this.cancelledOperationIds.has(operationId);
  }

  public clear(operationId: string): void {
    this.cancelledOperationIds.delete(operationId);
  }
}
