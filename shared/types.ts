// 人物节点
export interface Person {
  id: string;
  name: string;
  title?: string; // 职位 / 身份
  org?: string; // 公司 / 组织
  tags: string[]; // 领域标签，如 "法律" "投资" "医疗"
  traits: string[]; // 性格特点，如 "靠谱" "外向" "细致"
  strengths: string; // 优势 / 能帮上什么忙
  contact?: string;
  closeness: number; // 亲密度 1-5
  notes?: string;
  x: number;
  y: number;
  updatedAt: string;
}

// 关系连线
export interface Relation {
  id: string;
  source: string;
  target: string;
  label: string; // 如 "同事" "大学同学" "合作过"
  strength: number; // 1-5
  notes?: string;
}

export interface WebdavConfig {
  enabled: boolean;
  url: string; // 目录地址，如 https://dav.example.com/backup/
  username: string;
  password: string;
  intervalMinutes: number;
  keep: number; // 保留份数
  lastBackupAt?: string;
  lastError?: string;
}

export interface Board {
  version: 1;
  people: Person[];
  relations: Relation[];
  updatedAt: string;
}

export interface Settings {
  apiToken: string; // 外部 agent 读取用
  webdav: WebdavConfig;
}

export const emptyBoard = (): Board => ({
  version: 1,
  people: [],
  relations: [],
  updatedAt: new Date().toISOString(),
});
