import sys
sys.path.insert(0, ".")
from app.main import app
routes = [(r.path, list(r.methods)) for r in app.routes if hasattr(r, "path")]
for path, methods in sorted(routes, key=lambda x: x[0]):
    print(f"{path}: {methods}")