.PHONY: dfx-start dfx-stop dfx-deploy build dev clean

DFX_NETWORK ?= local

dfx-start:
	dfx start --background --clean

dfx-stop:
	dfx stop

dfx-deploy:
	dfx deploy --network $(DFX_NETWORK)

build:
	npx next build

dev:
	npx next dev

clean:
	rm -rf .next .dfx out

deploy-local: dfx-start dfx-deploy
	@echo "Local deploy complete. Canister ID:"
	@dfx canister id aegis_backend

deploy-ic:
	DFX_WARNING=-mainnet_plaintext_identity dfx deploy aegis_backend --network ic --identity default
