# Contingência da coleta

Em cada execução, tentar primeiro rastroseguro.1gps.com.br. Se o acesso,
login ou mapa falhar, ou a frota tiver menos de 250 veículos (limite já
adotado pelo coletor), abrir uma sessão independente em rastroseguro.2gps.com.br.
Os dois servidores usam os secrets RASTRO_USER e RASTRO_PASSWORD existentes.

Somente enviar uma coleta completa ao destino WORKER_URL existente. Se ambos
falharem, encerrar com erro sem enviar dados, preservando a última coleta.
Uma falha de envio ao Worker não provoca nova coleta no rastreador.
Cada execução seguinte volta a tentar o principal primeiro.

Os logs indicam a fonte utilizada e o acionamento da contingência. O payload
também inclui source e contingency. Não há mudança de domínio do Vision Tower,
de agendamento nem das regras operacionais. O limite do job passa a 10 minutos
para acomodar as duas tentativas e a instalação do navegador.

Validação automatizada: node --test. Cobertura: principal disponível, falhas de
rede/login/mapa, frota incompleta, indisponibilidade dupla e retorno ao principal.
A autenticação e compatibilidade do mapa no 2GPS precisam de validação operacional
com as credenciais configuradas; os testes automatizados usam dados simulados.
