.PHONY: test test-smoke lint

PYTEST=python3 -m pytest

TEST_ENV=

ifdef PLAN_REMOTE_BASE_URL
TEST_ENV += PLAN_REMOTE_BASE_URL=$(PLAN_REMOTE_BASE_URL)
endif
ifdef PLAN_REMOTE_TOKEN
TEST_ENV += PLAN_REMOTE_TOKEN=$(PLAN_REMOTE_TOKEN)
endif
ifdef PLAN_REMOTE_REFRESH_SECONDS
TEST_ENV += PLAN_REMOTE_REFRESH_SECONDS=$(PLAN_REMOTE_REFRESH_SECONDS)
endif

export PLAN_DATA_DIR ?=/var/lib/toolmgmt/plan

lint:
	flake8 app_flask.py

test:
	$(TEST_ENV) $(PYTEST) -q

# simple smoke test (same as test for now, kept for future expansion)
test-smoke: test
