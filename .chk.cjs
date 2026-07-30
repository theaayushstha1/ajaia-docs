const {Client}=require('pg');
const c=new Client({host:process.env.DB_HOST,port:5432,user:process.env.DB_USER,database:process.env.DB_NAME,password:process.env.DB_PASSWORD,ssl:{rejectUnauthorized:false}});
(async()=>{
  await c.connect();
  await c.query('drop table if exists document_presence cascade');
  await c.query('drop table if exists document_versions cascade');
  const r = await c.query("select table_name from information_schema.tables where table_schema='public' order by 1");
  console.log('tables now:', r.rows.map(x=>x.table_name).join(', '));
  const u = await c.query('select count(*)::int n from users');
  const d = await c.query('select count(*)::int n from documents');
  const s = await c.query('select count(*)::int n from document_shares');
  console.log(`demo data intact -> users:${u.rows[0].n} documents:${d.rows[0].n} shares:${s.rows[0].n}`);
  await c.end();
})().catch(e=>{console.log('ERR',e.message);process.exit(1)});
