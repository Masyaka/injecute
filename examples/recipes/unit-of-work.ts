import { DIContainer } from 'injecute';

export const log: string[] = [];

class Transaction {
  #committed = false;
  constructor(readonly id: number) {}
  query(sql: string): void {
    log.push(`tx${this.id}: ${sql}`);
  }
  commit(): void {
    this.#committed = true;
    log.push(`tx${this.id}: commit`);
  }
  [Symbol.dispose](): void {
    if (!this.#committed) log.push(`tx${this.id}: rollback`);
  }
}

class Database {
  #next = 1;
  begin(): Transaction {
    return new Transaction(this.#next++);
  }
}

// #region unit-of-work
/** The repositories of one business operation, bound to one transaction. */
class UnitOfWork {
  constructor(private readonly tx: Transaction) {}
  insertOrder(item: string): void {
    this.tx.query(`insert ${item}`);
  }
  commit(): void {
    this.tx.commit();
  }
  [Symbol.dispose](): void {
    this.tx[Symbol.dispose](); // rolls back unless committed
  }
}

class Checkout {
  constructor(private readonly work: { begin(): UnitOfWork }) {}

  placeOrder(item: string, quantity: number): void {
    // the unit of work lives in this block and is disposed at its end, also when it throws
    using work = this.work.begin();
    work.insertOrder(item);
    if (quantity < 1) throw new Error('quantity must be at least 1');
    work.commit();
  }
}

// The container provides the factory, a singleton; the caller owns what it creates.
const app = new DIContainer()
  .addSingleton('db', Database)
  .addSingleton(
    'unitOfWork',
    (db) => ({ begin: () => new UnitOfWork(db.begin()) }),
    ['db'],
  )
  .addSingleton('checkout', Checkout, ['unitOfWork']);

app.get('checkout').placeOrder('book', 1); // tx1: insert book, tx1: commit
// #endregion unit-of-work

export { app };
