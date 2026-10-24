import {
  Cpu,
  GraduationCap,
  Users,
  UserRound,
  Bookmark,
} from "lucide-react";

/** 团队信息由参赛团队提供，集中维护，避免分散在不同页面中。 */
export function AboutSettings() {
  return (
    <div className="about-layout">
      <section className="panel about-hero">
        <div className="about-team-icon">
          <Cpu size={37} />
        </div>
        <span className="eyebrow">SILICON AWAKENING</span>
        <h2>硅基觉醒</h2>
        <p className="about-english">Silicon Awakening</p>
        <p className="about-intro">
          我们是来自大连理工大学的硅基觉醒团队。
          <br />
          用技术留住思路，让每一次学习都能接续。
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Users size={20} />
            团队信息
          </h2>
          <span className="badge">参赛团队</span>
        </div>
        <dl className="team-details">
          <div>
            <dt>
              <Cpu size={17} />
              团队名称
            </dt>
            <dd>硅基觉醒（Silicon Awakening）</dd>
          </div>
          <div>
            <dt>
              <UserRound size={17} />
              队长姓名
            </dt>
            <dd>张尚臻</dd>
          </div>
          <div>
            <dt>
              <Users size={17} />
              团队成员
            </dt>
            <dd>庞博轩、马明泽</dd>
          </div>
          <div>
            <dt>
              <GraduationCap size={17} />
              学校
            </dt>
            <dd>大连理工大学</dd>
          </div>
        </dl>
      </section>
      <section className="panel about-product">
        <span className="brand-icon">
          <Bookmark size={22} />
        </span>
        <div>
          <h3>续页 · 学习断片续接器</h3>
          <p className="muted">
            保存中断时的进度、思路与下一步，帮助你从上次停下的地方继续。
          </p>
          <small>应用版本 1.5.0 · 由硅基觉醒团队参赛制作</small>
        </div>
      </section>
    </div>
  );
}
