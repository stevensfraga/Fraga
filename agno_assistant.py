#!/usr/bin/env python3
"""
Assistente de IA usando Agno e DeepSeek API
Autor: Especialista Agno
Requisitos: pip install agno duckduckgo-search python-dotenv
"""

import os
import sys
import readline  # Para histórico de comandos no terminal
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from agno import Agent, RunResponse
from agno.models import DeepSeek
from agno.tools import DuckDuckGoTools
from agno.tools.coding import CodingTools

# Carrega variáveis de ambiente de um arquivo .env se existir
load_dotenv()

class DeepSeekAssistant:
    """Classe principal do assistente de IA com DeepSeek."""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Inicializa o assistente.
        
        Args:
            api_key: Chave da API DeepSeek. Se None, tenta obter de DEEPSEEK_API_KEY.
        """
        # Configuração da chave API (prioridade: argumento > env > chave fornecida)
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY") or "sk-8aa262b9009b4406a36c727b888212af"
        
        # Cria diretório workspace se não existir
        self.workspace_dir = Path("./workspace")
        self.workspace_dir.mkdir(exist_ok=True)
        
        # Inicializa o agente Agno
        self.agent = self._create_agent()
        
        # Histórico de conversa
        self.conversation_history = []
        
    def _create_agent(self) -> Agent:
        """Cria e configura o agente Agno."""
        
        # Modelo DeepSeek via API
        model = DeepSeek(
            id="deepseek-chat",
            api_key=self.api_key,
            temperature=0.7,
            max_tokens=4000,
        )
        
        # Cria o agente com ferramentas
        agent = Agent(
            name="DeepSeek Assistant",
            model=model,
            tools=[
                CodingTools(
                    base_dir=str(self.workspace_dir),
                    all=True,  # Habilita todas as funcionalidades de código
                ),
                DuckDuckGoTools(),
            ],
            instructions="""
            Você é um assistente de IA útil e especializado em programação, 
            pesquisa na web e análise de dados. Siga estas diretrizes:
            
            1. Use markdown para formatar suas respostas (títulos, listas, código, etc.)
            2. Sempre mostre as chamadas de ferramentas (tool calls) que você faz
            3. Para código, forneça exemplos completos e funcionais
            4. Para pesquisas, busque informações atualizadas e cite fontes
            5. Seja conciso mas completo nas respostas
            6. Para operações de arquivo, use o workspace (./workspace)
            7. Em Python, use boas práticas e tratamento de exceções
            
            Comandos especiais do usuário:
            - /sair: Encerra a sessão
            - /clear: Limpa o histórico da conversa
            - /help: Mostra ajuda
            
            IMPORTANTE: A chave API fornecida é válida, use-a com responsabilidade.
            """,
            markdown=True,
            show_tool_calls=True,
            debug_mode=False,
        )
        
        return agent
    
    def clear_history(self):
        """Limpa o histórico de conversa."""
        self.conversation_history.clear()
        print("✅ Histórico de conversa limpo.")
    
    def show_help(self):
        """Exibe a ajuda dos comandos."""
        help_text = """
        🤖 **DeepSeek Assistant - Comandos Disponíveis**
        
        **Comandos do Sistema:**
        - `/sair` - Encerra o assistente
        - `/clear` - Limpa o histórico da conversa
        - `/help` - Mostra esta mensagem de ajuda
        
        **Funcionalidades:**
        - 💻 **CodingTools**: Cria, edita, executa e depura código em ./workspace
        - 🌐 **DuckDuckGoTools**: Pesquisa na web para informações atualizadas
        - 📝 **Markdown**: Respostas formatadas com sintaxe markdown
        - 🔧 **Tool Calls**: Visualização das ferramentas usadas
        
        **Exemplos de Perguntas:**
        - "Crie um script Python para calcular Fibonacci"
        - "Pesquise as últimas notícias sobre IA"
        - "Ajude-me a debugar este erro: [cole o erro]"
        - "Crie um arquivo HTML com um formulário de contato"
        
        **Workspace:** Todos os arquivos de código são salvos em `./workspace/`
        """
        print(help_text)
    
    def process_command(self, user_input: str) -> bool:
        """
        Processa comandos especiais ou envia para o agente.
        
        Args:
            user_input: Entrada do usuário.
            
        Returns:
            bool: True para continuar executando, False para sair.
        """
        # Comandos especiais
        if user_input.lower() == "/sair":
            print("👋 Até logo!")
            return False
        
        elif user_input.lower() == "/clear":
            self.clear_history()
            return True
        
        elif user_input.lower() == "/help":
            self.show_help()
            return True
        
        # Processa com o agente
        try:
            print("\n" + "="*60)
            print("🤖 Processando...")
            print("="*60 + "\n")
            
            # Executa a consulta com o agente
            response: RunResponse = self.agent.run(user_input)
            
            # Adiciona ao histórico
            self.conversation_history.append({
                "user": user_input,
                "assistant": response.content
            })
            
            print("\n" + "="*60)
            print("✅ Resposta concluída")
            print("="*60 + "\n")
            
        except Exception as e:
            print(f"\n❌ Erro ao processar: {e}")
            print("Verifique sua conexão com a internet e a chave API.")
        
        return True
    
    def run_interactive(self):
        """Executa o loop interativo do terminal."""
        print("\n" + "="*60)
        print("🤖 DEEPSEEK ASSISTANT - AGNO FRAMEWORK")
        print("="*60)
        print("Versão: 1.0 | Modelo: deepseek-chat (API)")
        print(f"Workspace: {self.workspace_dir.absolute()}")
        print("="*60)
        print("Digite sua pergunta ou comando (/help para ajuda)")
        print("="*60 + "\n")
        
        # Configura histórico de comandos
        try:
            histfile = os.path.join(os.path.expanduser("~"), ".agno_history")
            readline.read_history_file(histfile)
            readline.set_history_length(1000)
        except FileNotFoundError:
            pass
        
        running = True
        while running:
            try:
                # Obtém entrada do usuário
                user_input = input("\n💬 Você: ").strip()
                
                if not user_input:
                    continue
                
                # Processa o comando
                running = self.process_command(user_input)
                
            except KeyboardInterrupt:
                print("\n\n⚠️  Interrompido pelo usuário. Use /sair para sair.")
                continue
            except EOFError:
                print("\n\n👋 Até logo!")
                running = False
            except Exception as e:
                print(f"\n❌ Erro inesperado: {e}")
                continue
        
        # Salva histórico
        try:
            readline.write_history_file(histfile)
        except:
            pass

def main():
    """Função principal."""
    
    # Verifica dependências
    try:
        import agno
        import duckduckgo_search
    except ImportError as e:
        print("❌ Dependências não instaladas.")
        print("Execute: pip install agno duckduckgo-search python-dotenv")
        sys.exit(1)
    
    # Inicializa e executa o assistente
    try:
        assistant = DeepSeekAssistant()
        assistant.run_interactive()
    except Exception as e:
        print(f"❌ Falha ao iniciar assistente: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
