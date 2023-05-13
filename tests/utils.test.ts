import { expect } from "chai";
import { describe } from "mocha";
import { DIContainer } from "../src";
import { asNew } from "../src/utils/construct";

describe("utils", () => {
  describe("asNew", () => {
    class ClassWithConstructor {
      constructor(public readonly field1: number, public readonly field2: string) {
      }
    }

    it("creates instantiation function", () => {
      const construct = asNew(ClassWithConstructor);
      const instance = construct(1, "2");
      expect(instance).to.be.instanceOf(ClassWithConstructor);
      expect(instance.field1).to.be.a("number");
      expect(instance.field2).to.be.a("string");
    });
    it("works in container", () => {
      const container = new DIContainer()
        .addTransient("number", () => 1, [])
        .addInstance("string", "2")
        .addTransient("x", asNew(ClassWithConstructor), ["number", "string"]);

      const instance = container.get("x");
      expect(instance).to.be.instanceOf(ClassWithConstructor);
      expect(instance.field1).to.be.a("number");
      expect(instance.field2).to.be.a("string");
    });
  });
});
