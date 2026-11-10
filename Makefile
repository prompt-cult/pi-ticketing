# pi-ticketing/Makefile — install the pi extension payload.
#
# The payload is ONLY extensions/ + skills/ticketing. Nothing else in this
# repo is read or touched. All recipes are .PHONY (the paths they name do not
# exist inside this repo).
#
# pi discovery facts this layout depends on:
#   - extensions: ONE level deep — <root>/extensions/*.ts or */index.ts
#     (project: .pi/extensions/, user: ~/.pi/agent/extensions/). A multi-file
#     extension with relative imports must therefore live in a single
#     namespace directory whose root contains index.ts.
#   - skills: directories containing SKILL.md, discovered RECURSIVELY from
#     .pi/skills/ (project) and ~/.pi/agent/skills/ (user).

EXT_NAME   := pi-ticketing
SKILL_NAME := ticketing
EXT_SRC    := extensions
SKILL_SRC  := skills/$(SKILL_NAME)
PI_AGENT   := $(HOME)/.pi/agent

DEST ?=
PRUNE ?=

.DEFAULT_GOAL := all
.PHONY: all help test install-repo install-global uninstall-repo uninstall-global

all: help

help: ## Show this help
	@printf 'pi-ticketing — install the pi extension payload\n\n'
	@awk -F':.*## ' '/^[a-zA-Z0-9_-]+:.*## / \
		{ printf "  make %-18s %s\n", $$1, $$2 }' $(firstword $(MAKEFILE_LIST))

test: ## Run the contract tests (node --test, no pi needed)
	@node --test --experimental-strip-types $(EXT_SRC)/lib/ticket.test.ts

install-repo: ## DEST=<path/to/git-repo> — install project-local into DEST/.pi/
	@if [ -z "$(strip $(DEST))" ]; then \
		echo 'usage: make install-repo DEST=<path/to/git-repo> [PRUNE=1]'; \
		echo "  copies $(EXT_SRC)/ -> DEST/.pi/extensions/$(EXT_NAME)/"; \
		echo "  copies $(SKILL_SRC)/ -> DEST/.pi/skills/$(SKILL_NAME)/"; \
		exit 2; \
	fi; \
	dest="$$(echo $(DEST))"; \
	test -d "$$dest" || { echo "install-repo: not a directory: $$dest" >&2; exit 1; }; \
	test -e "$$dest/.git" || { echo "install-repo: no .git in $$dest — refusing (not a git repo)" >&2; exit 1; }; \
	ext="$$dest/.pi/extensions/$(EXT_NAME)"; skill="$$dest/.pi/skills/$(SKILL_NAME)"; \
	if [ "$(PRUNE)" = "1" ]; then rm -rf "$$ext" "$$skill"; fi; \
	mkdir -p "$$ext" "$$skill"; \
	cp -R "$(EXT_SRC)/." "$$ext/"; \
	cp -R "$(SKILL_SRC)/." "$$skill/"; \
	echo "install-repo: $(EXT_NAME) -> $$ext"; \
	echo "install-repo: $(SKILL_NAME) skill -> $$skill"; \
	echo 'pi loads project-local extensions after you trust the project; run /reload if pi is live.'

install-global: ## Install into ~/.pi/agent/ (every project, this user)
	@ext="$(PI_AGENT)/extensions/$(EXT_NAME)"; skill="$(PI_AGENT)/skills/$(SKILL_NAME)"; \
	if [ "$(PRUNE)" = "1" ]; then rm -rf "$$ext" "$$skill"; fi; \
	mkdir -p "$$ext" "$$skill"; \
	cp -R "$(EXT_SRC)/." "$$ext/"; \
	cp -R "$(SKILL_SRC)/." "$$skill/"; \
	echo "install-global: $(EXT_NAME) -> $$ext"; \
	echo "install-global: $(SKILL_NAME) skill -> $$skill"; \
	echo 'run /reload in a live pi session to load it now.'

uninstall-repo: ## DEST=<path> — remove what install-repo owns
	@test -n "$(strip $(DEST))" || { echo 'usage: make uninstall-repo DEST=<path>' >&2; exit 2; }; \
	dest="$$(echo $(DEST))"; \
	test -d "$$dest/.pi" || { echo "uninstall-repo: nothing at $$dest/.pi" >&2; exit 1; }; \
	rm -rf "$$dest/.pi/extensions/$(EXT_NAME)" "$$dest/.pi/skills/$(SKILL_NAME)"; \
	echo "uninstall-repo: removed $(EXT_NAME) and the $(SKILL_NAME) skill from $$dest/.pi"

uninstall-global: ## Remove what install-global owns
	@rm -rf "$(PI_AGENT)/extensions/$(EXT_NAME)" "$(PI_AGENT)/skills/$(SKILL_NAME)"; \
	echo "uninstall-global: removed $(EXT_NAME) and the $(SKILL_NAME) skill from $(PI_AGENT)"
