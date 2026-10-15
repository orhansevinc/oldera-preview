const originalText = Response.prototype.text;
Response.prototype.text = function textWithoutConsumingOriginal() {
  return originalText.call(this.clone());
};
