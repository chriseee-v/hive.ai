import time
from fastapi.testclient import TestClient

from app.main import app, agents, tasks


def setup_function():
    tasks.clear()
    for agent in agents.values():
        agent.state = "idle" if agent.id == "demo" else "stopped"


def test_health_and_registry():
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert {a["id"] for a in client.get("/api/agents").json()} == {"demo", "codex", "ollama"}


def test_demo_task_runs_without_approval():
    with TestClient(app) as client:
        response = client.post("/api/tasks", json={"prompt": "hello", "agent_id": "demo"})
        assert response.status_code == 202
        task_id = response.json()["id"]
        for _ in range(20):
            task = client.get(f"/api/tasks/{task_id}").json()
            if task["status"] == "completed":
                break
            time.sleep(0.01)
        assert task["status"] == "completed"
        assert "hello" in task["result"]


def test_codex_task_requires_approval():
    with TestClient(app) as client:
        client.post("/api/agents/codex/start")
        response = client.post("/api/tasks", json={"prompt": "inspect", "agent_id": "codex"})
        assert response.status_code == 202
        assert response.json()["status"] == "awaiting_approval"


def test_unknown_agent_is_rejected():
    with TestClient(app) as client:
        assert client.post("/api/tasks", json={"prompt": "x", "agent_id": "missing"}).status_code == 404

