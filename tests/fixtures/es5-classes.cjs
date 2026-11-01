// Generated from tests/fixtures/es5-classes.source.ts.txt with TypeScript 6 (target: es5). Do not edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Empty = exports.MethodsNoThis = exports.FieldsOnly = exports.WithMethods = void 0;
// Source of tests/fixtures/es5-classes.cjs (compiled with TypeScript 6, target es5).
var WithMethods = /** @class */ (function () {
    function WithMethods(dep) {
        this.dep = dep;
    }
    WithMethods.prototype.hello = function () {
        return 'hi ' + this.dep;
    };
    return WithMethods;
}());
exports.WithMethods = WithMethods;
var FieldsOnly = /** @class */ (function () {
    function FieldsOnly(dep) {
        this.dep = dep;
    }
    return FieldsOnly;
}());
exports.FieldsOnly = FieldsOnly;
var MethodsNoThis = /** @class */ (function () {
    function MethodsNoThis() {
    }
    MethodsNoThis.prototype.hello = function () {
        return 'hi';
    };
    return MethodsNoThis;
}());
exports.MethodsNoThis = MethodsNoThis;
var Empty = /** @class */ (function () {
    function Empty() {
    }
    return Empty;
}());
exports.Empty = Empty;
