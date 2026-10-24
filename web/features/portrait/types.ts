export interface TeacherContext {
  id:number; name:string; teacher_no:string; college_name:string;
  classes:{id:number;name:string;student_count:number}[];
  class_count:number; student_count:number;
}
export interface Person {
  id:number; name:string; code:string; username:string|null; college_name:string;
  class_id?:number; class_name?:string;
  classes?:TeacherContext["classes"]; class_count?:number; student_count?:number;
}
export interface PeoplePage {items:Person[];total:number;page:number;page_size:number}
export interface Catalog {
  semesters: {id:number;name:string;start_date:string;end_date:string}[];
  semester_id:number|null;
  students:{id:number;name:string;student_no:string;class_id:number;class_name:string}[];
  classes:{id:number;name:string;college_id:number}[];
  directory_classes:Catalog["classes"];
  colleges:{id:number;name:string}[];
  first_student:Catalog["students"][number]|null;
  student_count:number; teacher:TeacherContext|null; can_select_teacher:boolean;
  can_compare:boolean; demo:boolean;
}
export interface Overview {
  dimension:"student"|"class"|"scope"; title:string; student_id:number|null; class_id:number|null;
  teacher:TeacherContext|null;
  semester:{id:number;name:string};
  profile:null|{student_no:string;college_name:string;major_name:string;class_name:string;enrollment_date:string|null;graduation_date:string|null;dormitory:string|null};
  summary:{average:number|null;gpa:number|null;passed_credits:number|null;total_credits:number;course_count:number;student_count:number;behavior_coverage:number};
  courses:{id:number;name:string;code:string;credits:number;earned_credits:number|null;kind:string|null;score:number|null;full_score:number;status:string;sample_count:number}[];
  metrics:Record<string,number|null>;
  radar:{key:string;label:string;raw:number|null;unit:string;maximum:number;value:number|null}[];
  tags:{code:string;name:string;value:string;weight:number}[];
  board:{mode:"date"|"semester";points:{label:string;attendance:number|null;study:number|null;sleep:number|null;internet:number|null}[]};
  demo:boolean;revision:number;calculation:string;
}
