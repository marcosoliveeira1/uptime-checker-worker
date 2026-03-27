.PHONY: dev test build clean

dev:
	docker compose up --build

infra:
	docker compose up rabbitmq

test:
	npx vitest run

test-watch:
	npx vitest watch

test-coverage:
	npx vitest run --coverage

build:
	npx tsc -p tsconfig.build.json

clean:
	rm -rf dist
