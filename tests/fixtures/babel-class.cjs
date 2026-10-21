// What Babel emits for `class BabelClass { constructor(dep) { this.dep = dep } hello() {} }`
// when targeting old browsers: a function guarded by _classCallCheck.
'use strict';
function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError('Cannot call a class as a function');
  }
}
var BabelClass = /*#__PURE__*/ (function () {
  function BabelClass(dep) {
    _classCallCheck(this, BabelClass);
    this.dep = dep;
  }
  BabelClass.prototype.hello = function hello() {
    return 'hi';
  };
  return BabelClass;
})();
exports.BabelClass = BabelClass;
