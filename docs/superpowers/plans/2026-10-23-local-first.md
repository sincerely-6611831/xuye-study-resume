# 本地优先、手动同步与本地模型

用户已认可逐设备保存、离线任务操作、选中后同步、冲突保留版本，并要求加入本地模型接口。沿用现有分支与模块化中文注释，不发布公网、不安装或下载模型。

架构：浏览器IndexedDB是学习数据的正式来源；任务、会话、快照、材料Blob、AI原文/卡片均在本机。原API页面通过本地仓库适配，登录及用户主动AI计算仍经过当前电脑网关。旧服务端数据首次读取迁移到本机，旧库保留。设置保存在本机；密钥封装为当前网关可解密的密文，不进入同步和学习备份。无网络时可读写本地任务，AI要连接运行模型的电脑。

1. 后端：device_sync.py独立同步表，账号隔离；GET /api/device-sync -> [{task_id,title,revision,updated_at,device_name}]；GET /api/device-sync/{task_id} -> {revision,bundle}；PUT相同地址 body {expected_revision:int|null,device_name:str,bundle:{detail:Detail,files:[{id,data:base64}]}} -> {revision}。空expected只可新建，冲突409且保留远端旧版本。严格校验体积、学习字段/引用，不接受设置/密钥。历史表保留每版。不能写旧tasks表。
2. 无状态AI：POST /api/local-ai/seal {api_key} -> {encrypted_key}；POST /api/local-ai/chat {config:{name,api_url,model,timeout,encrypted_key},prompt} -> {raw}；POST /api/local-ai/models {config} -> {models:[str]}，从chat/completions推导同根/v1/models；POST /api/local-ai/transcribe multipart config(JSON),file -> {transcript,model}；POST /api/local-ai/summarize {config,task:{title,goal,plugin_id},transcript} -> {fields,domain_data,model,profile_name}。复用白名单与协议；只处理本次输入，不保存学习数据或凭据。无key可留空。Ollama/LM Studio兼容Chat Completions及models协议。
3. frontend/src/local/：repository.mjs 管本机task记录 {detail,files(Blob映射),base_revision:null|int,dirty,local_version}；adapter.mjs 适配原任务/AI/设置API；backup.mjs ZIP本机导出恢复，包含附件排除模型配置；sync.mjs 导出 listLocalTasks(), listRemoteTasks(), pushTask(id), pullTask(id)；只在按钮触发网络，pull若本机dirty则先fork完整副本再接收远端。push使用base_revision，迟到响应不能把新编辑标成已同步。
4. 设置UI：SyncSettings.tsx显式选任务、刷新远端、发送与接收、冲突提示和保留副本；申请持久存储与本机ZIP导出/恢复。模型页提供Ollama(11434)/LM Studio(1234)预设、读取已安装模型、连接测试，明确地址从运行Python的电脑解释。沿用当前模型/语音配置字段，额外encrypted_key只在内部仓库中使用，不回显。DataSettings导出按钮走本机backup模块，不再直连服务端。
5. 根集成：api/client.ts区分remoteApi与localApi；Workspace附件下载走本机Blob；文字改为本机保存，与跨设备同步分开；App在线状态不把本机API成功当网关在线。本地功能测试（禁用fetch仍能新建/暂停/附件/确认卡）、同步冲突和迟到响应、备份往返、账号隔离；后端全量与前端构建；独立代码审查与双设备浏览器验证。

本地仓库提供给设置模块的接口：api/client.ts export remoteApi<T>(path,options)，api仍是原签名；local/sync.mjs export listLocalTasks() -> [{task_id,title,dirty,base_revision,updated_at}], listRemoteTasks(), pushTask(taskId), pullTask(taskId) -> {keptCopy:boolean}；local/backup.mjs export downloadBackup(format:'zip'|'json'|'markdown'), restoreBackup(file:File) -> {imported:number}；所有接口内部解析当前study-last-user，按账号隔离。SyncSettings使用这些接口，不直接写IndexedDB。ModelSettings读取模型列表通过post('/local-models/list',{profile_id})，适配器负责解析密钥及网关调用。

进度：已实现。基线bb819bc。后端代理负责后端与后端测试；设置代理负责SyncSettings、DataSettings、ModelSettings；主代理负责本地仓库、API集成、测试与验收。独立审查5项问题已通过回归测试修复。后端58项、前端23项测试和生产构建通过；双站点浏览器验证显式同步、本机ZIP恢复、网关关闭后的离线新建暂停、本机模拟模型服务的列表/连接。真实模型未安装，接口已就绪。

实现裁定：学习任务按整件选择，附件与记录一起同步；无云端注册或发布。未填入的语音另存本机暂存，不默认同步或导出，界面与README明确此边界。为避免备份不可恢复，按任务分卷，每卷48MB；旧版超过同步附件30MB限制的任务仍可在本机保存/备份，同步会提示体积限制。首次迁移网络失败可在重新联网后刷新重试，旧库始终保留。
