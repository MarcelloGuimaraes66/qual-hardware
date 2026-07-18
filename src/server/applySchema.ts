import { createStore } from "./store.js";

const store = createStore();
try {
  console.log("Qual Hardware SQLite schema applied.");
} finally {
  await store.close();
}
