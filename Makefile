# Build an unsigned XPI from source. Signing happens on addons.mozilla.org;
# an unlisted version is signed automatically, without human review.
EXT     := watch_later_ext
VERSION := $(shell python3 -c "import json;print(json.load(open('$(EXT)/manifest.json'))['version'])")
XPI     := $(EXT)@k11m1.eu-$(VERSION).xpi

.PHONY: xpi clean check

xpi: $(XPI)

$(XPI): $(wildcard $(EXT)/*)
	@python3 make_xpi.py

# Cheap pre-flight: valid JSON, valid JS, no dangling file references.
check:
	@python3 -c "import json;json.load(open('$(EXT)/manifest.json'));print('manifest.json: valid')"
	@for f in $(EXT)/*.js; do node --check "$$f" >/dev/null && echo "$$f: syntax OK"; done
	@python3 -c "import ast;ast.parse(open('watch_later_nm.py').read());print('watch_later_nm.py: syntax OK')"

clean:
	rm -f $(EXT)@k11m1.eu*.xpi
