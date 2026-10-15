import { resetPassword, verifyLogin, closeSys } from "../src/lib/system";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: tsx scripts/reset-password.ts <email> <new-password>");
  process.exit(1);
}
resetPassword(email, password);
console.log("verified:", verifyLogin(email, password).email);
closeSys();
