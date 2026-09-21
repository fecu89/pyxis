import "../lib/load-env";
import { sweepPadTrash } from "../lib/files/pad-trash-sweep";
import { getPrisma } from "../lib/prisma";

sweepPadTrash()
  .then((result) => {
    console.log(JSON.stringify({ ...result, cutoff: result.cutoff.toISOString() }));
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
