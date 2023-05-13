import { expect } from "chai";
import { describe, it } from "mocha";
import {
  CircularDependencyError,
  DIContainer,
  IDIContainerExtension,
  optionalDependencySkipKey,
} from "../src";

describe("injecute container", () => {
  describe("DI container general", () => {
    it("should allow to override parent service using parent service", () => {
      const parent = new DIContainer().addTransient("s", () => ({ x: 1 }), []);
      const child = new DIContainer(parent).extend((c) => {
        return c.addTransient(
          "s",
          () => {
            const s = parent.get("s");
            return { ...s, y: 2 };
          },
          []
        );
      });
      expect(child.get("s")).to.be.eql({ x: 1, y: 2 });
    });

    it("should prevent creating of circular dependencies", () => {
      const addZ: IDIContainerExtension<any, any> = (container) =>
        container.addTransient(
          "z",
          (y) => ({
            ...y,
            z: 1,
          }),
          ["y"]
        );
      const c = new DIContainer()
        .addTransient("x", (z: any) => ({ ...z, x: 1 }), ["z"] as any)
        .addTransient("y", (x) => ({ ...x, y: 1 }), ["x"]);
      
      expect(() => c.extend(addZ)).to.throw(CircularDependencyError);
    });
  });
  describe("explicit keys providing container", () => {
    it("will allow to not provide optional dependency key", () => {
      class SrvWithOptionalConstructorArgument {
        constructor(public readonly val: string | undefined = undefined) {}
      }

      const c = new DIContainer().addSingleton(
        "s",
        SrvWithOptionalConstructorArgument,
        ["undefined"]
      );
      expect(c.get("s")).to.be.instanceOf(SrvWithOptionalConstructorArgument);
    });

    it("will not allow to add service with optional dependency key", () => {
      const addSingletonUndefinedKey = () =>
        new DIContainer().addSingleton(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey,
          []
        );
      expect(addSingletonUndefinedKey).to.throw;

      const addInstanceUndefinedKey = () =>
        new DIContainer().addInstance(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey
        );
      expect(addInstanceUndefinedKey).to.throw;

      const addTransientUndefinedKey = () =>
        new DIContainer().addTransient(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey,
          []
        );
      expect(addTransientUndefinedKey).to.throw;
    });

    it("will restrict adding to container without explicit keys providing", () => {
      const c = new DIContainer();
      expect(() =>
        c.addTransient("d", (arg: any) => {
          console.log(arg);
        })
      ).to.throw;
    });
    it("will add service with explicit keys provided", () => {
      const c = new DIContainer<{}>();
      const getMultiplied2By2 = () =>
        c
          .addTransient("multiplier", () => 2, { explicitArgumentsNames: [] })
          .addTransient("multiplied2", (n) => 2 * n, ["multiplier"])
          .get("multiplied2");
      expect(getMultiplied2By2()).to.be.eql(4);
    });
    it("should allow to use symbols as keys", () => {
      const c = new DIContainer<{}>();
      const multiplierKey = Symbol("multiplier");
      const multiplierStringKey = Symbol("multiplierString");
      const getMultiplied2By2 = () =>
        c
          .addInstance(multiplierStringKey, "2")
          .addSingleton(multiplierKey, (str) => Number(str), {
            explicitArgumentsNames: [multiplierStringKey],
          })
          .addTransient("multiplied2", (n: number) => 2 * n, {
            explicitArgumentsNames: [multiplierKey],
          })
          .get("multiplied2");
      expect(getMultiplied2By2()).to.be.eql(4);
    });
  });
  describe("proxy", () => {
    it("resolves services with access throw the container.proxy", () => {
      const container = new DIContainer()
        .addSingleton(
          "rootService",
          () => {
            return {
              x: 1,
              y: 2,
            };
          },
          []
        )
        .addTransient(
          "dependentService",
          (s) => {
            return {
              s,
            };
          },
          ["rootService"]
        );

      const r = container.proxy.dependentService;
      expect(r).is.eql({ s: { x: 1, y: 2 } });
    });
  });
  describe("middlewares", () => {
    it("allow to use few middlewares", () => {
      const checkpoints: string[] = [];
      new DIContainer()
        .use((name, next) => {
          checkpoints.push("before1");
          const r = next(name);
          checkpoints.push("after1");
          return r;
        })
        .use((name, next) => {
          checkpoints.push("before2");
          const r = next(name);
          checkpoints.push("after2");
          return r;
        })
        .addSingleton("x", () => "y", [])
        .get("x");

      expect(checkpoints).to.be.eql(["before2", "before1", "after1", "after2"]);
    });
    it("child container will use parent middlewares", () => {
      const checkpoints: string[] = [];
      const parentContainer = new DIContainer().use((name, next) => {
        checkpoints.push("before1");
        const r = next(name);
        checkpoints.push("after1");
        return r;
      });

      const r = parentContainer
        .fork()
        .addSingleton("x", () => "y", [])
        .get("x");

      expect(r).to.be.eql("y");
      expect(checkpoints).to.be.eql(["before1", "after1"]);
    });
  });
});
