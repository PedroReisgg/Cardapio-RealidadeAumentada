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
  supabaseUrl: '',
  supabaseAnonKey: '',
  menuId: 'default',
  bucket: 'cardapio',
};
