// Configuração do Cardápio 3D.
//
// backend:
//   'auto'     -> usa o Supabase se estiver configurado abaixo; senão o servidor local (npm run dev);
//                 se nenhum responder, mostra o cardápio de exemplo (data/menu.json).
//   'local'    -> sempre o servidor local
//   'supabase' -> sempre a nuvem (Supabase)
//
// Para salvar na nuvem: crie um projeto grátis em https://supabase.com, rode o arquivo
// supabase/schema.sql e cole aqui a URL e a chave "anon public" do projeto.
// (A chave anon é pública por natureza; a segurança fica nas regras do schema.sql.)
export const CONFIG = {
  backend: 'auto',
  supabaseUrl: 'https://zfmqdwstoyegwtxuakyk.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmbXFkd3N0b3llZ3d0eHVha3lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5OTk5OTksImV4cCI6MjEwOTU3NTk5OX0.YxLnAKOIZB9OOkESGvWjM1DpeA9n_4BT3SsnoM02qz0',
  menuId: 'default',
  bucket: 'cardapio',
};
