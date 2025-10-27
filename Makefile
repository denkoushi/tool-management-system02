.PHONY: test test-smoke lint

PYTEST=python3 -m pytest

TEST_ENV=

lint:
	flake8 app_flask.py

test:
	$(TEST_ENV) $(PYTEST) -q

# simple smoke test (same as test for now, kept for future expansion)
test-smoke: test
