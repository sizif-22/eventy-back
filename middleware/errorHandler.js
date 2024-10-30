function errorHandler(err, req, res, next) {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request entity too large" });
    }
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      return res.status(400).json({ error: "Invalid JSON format" });
    }
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
  
  module.exports = errorHandler;