/**
 * Wraps constructor to function to allow instantiation without `new` keyword.
 * @param C class constructor
 */
export const construct =
  <
    Constructor extends { new (...args: any[]): any },
    Instance extends Constructor extends {
      new (...args: any[]): infer I;
    }
      ? I
      : never,
    Args extends Constructor extends {
      new (...args: infer A): any;
    }
      ? A
      : never,
  >(
    C: Constructor,
  ) =>
  (...args: Args): Instance =>
    new C(...args);
