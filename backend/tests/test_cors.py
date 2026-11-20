from main import DEFAULT_ALLOWED_ORIGINS, get_allowed_origins


def test_defaults_to_local_dev_origins(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert get_allowed_origins() == DEFAULT_ALLOWED_ORIGINS


def test_blank_value_falls_back_to_defaults(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", " , ")
    assert get_allowed_origins() == DEFAULT_ALLOWED_ORIGINS


def test_parses_comma_separated_origins(monkeypatch):
    monkeypatch.setenv(
        "ALLOWED_ORIGINS",
        " https://netradar.example.com/ ,http://localhost:5173",
    )
    assert get_allowed_origins() == [
        "https://netradar.example.com",
        "http://localhost:5173",
    ]
